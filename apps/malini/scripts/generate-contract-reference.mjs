import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import ts from 'typescript';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractRoot = resolve(appRoot, 'src/contract');
const eventsPath = resolve(contractRoot, 'events.ts');
const catalogPath = resolve(contractRoot, 'event-catalog.ts');
export const REFERENCE_MODULE = resolve(contractRoot, 'contract-reference.generated.ts');
export const EVENTS_PAGE = resolve(appRoot, '../site/content/reference/events.md');

/**
 * @typedef {{ channel: string; description: string; payloadType: string; payload: string }} EventReference
 */

/** @returns {EventReference[]} */
export function readEventReference() {
	const program = ts.createProgram([eventsPath, catalogPath], {
		strict: true,
		noEmit: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
	});
	const checker = program.getTypeChecker();
	const events = requireSource(program, eventsPath);
	const contractEvents = events.statements.find(
		(statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === 'ContractEvents',
	);
	if (!contractEvents || !ts.isInterfaceDeclaration(contractEvents)) {
		throw new Error('src/contract/events.ts no longer declares interface ContractEvents');
	}
	const descriptions = readDescriptions(requireSource(program, catalogPath));
	return contractEvents.members.map((member) => {
		if (!ts.isPropertySignature(member) || !member.type || !ts.isStringLiteral(member.name)) {
			throw new Error(`ContractEvents member ${member.getText()} is not '<channel>': <Payload>`);
		}
		const channel = member.name.text;
		const description = descriptions.get(channel);
		if (description === undefined) throw new Error(`EVENT_CATALOG has no entry for ${channel}`);
		return {
			channel,
			description,
			payloadType: member.type.getText(),
			payload: declarationsOf(checker, member.type).join('\n\n'),
		};
	});
}

/**
 * @param {ts.Program} program
 * @param {string} path
 * @returns {ts.SourceFile}
 */
function requireSource(program, path) {
	const source = program.getSourceFile(path);
	if (!source) throw new Error(`cannot read ${path}`);
	return source;
}

/**
 * @param {ts.SourceFile} catalog
 * @returns {Map<string, string>}
 */
function readDescriptions(catalog) {
	/** @type {ts.Expression | undefined} */
	let literal;
	for (const statement of catalog.statements) {
		if (!ts.isVariableStatement(statement)) continue;
		for (const declaration of statement.declarationList.declarations) {
			if (ts.isIdentifier(declaration.name) && declaration.name.text === 'EVENT_CATALOG') {
				literal = declaration.initializer;
			}
		}
	}
	if (!literal || !ts.isObjectLiteralExpression(literal)) {
		throw new Error('EVENT_CATALOG must be an object literal');
	}
	const descriptions = new Map();
	for (const entry of literal.properties) {
		if (!ts.isPropertyAssignment(entry) || !ts.isStringLiteral(entry.name)) {
			throw new Error(`EVENT_CATALOG entry ${entry.getText()} must be '<channel>': { ... }`);
		}
		const description =
			ts.isObjectLiteralExpression(entry.initializer) &&
			entry.initializer.properties.find(
				(property) =>
					ts.isPropertyAssignment(property) &&
					ts.isIdentifier(property.name) &&
					property.name.text === 'description',
			);
		if (
			!description ||
			!ts.isPropertyAssignment(description) ||
			!ts.isStringLiteralLike(description.initializer)
		) {
			throw new Error(`EVENT_CATALOG ${entry.name.text} needs a string literal description`);
		}
		descriptions.set(entry.name.text, description.initializer.text);
	}
	return descriptions;
}

/**
 * @param {ts.TypeChecker} checker
 * @param {ts.Node} root
 * @returns {string[]}
 */
function declarationsOf(checker, root) {
	/** @type {Set<ts.Node>} */
	const seen = new Set();
	/** @type {string[]} */
	const texts = [];
	/** @param {ts.Node} node */
	const visit = (node) => {
		const name = ts.isTypeReferenceNode(node)
			? node.typeName
			: ts.isTypeQueryNode(node)
				? node.exprName
				: null;
		if (name) for (const declaration of contractDeclarations(checker, name)) include(declaration);
		ts.forEachChild(node, visit);
	};
	/** @param {ts.Node} declaration */
	const include = (declaration) => {
		const statement = ts.isVariableDeclaration(declaration)
			? declaration.parent.parent
			: declaration;
		if (seen.has(statement)) return;
		seen.add(statement);
		visit(statement);
		texts.push(statement.getText().replace(/^export /u, ''));
	};
	visit(root);
	return texts;
}

/**
 * @param {ts.TypeChecker} checker
 * @param {ts.EntityName | ts.Expression} name
 * @returns {ts.Node[]}
 */
function contractDeclarations(checker, name) {
	let symbol = checker.getSymbolAtLocation(name);
	if (!symbol) return [];
	if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
	return (symbol.declarations ?? []).filter(
		(declaration) =>
			declaration.getSourceFile().fileName.startsWith(contractRoot) &&
			(ts.isInterfaceDeclaration(declaration) ||
				ts.isTypeAliasDeclaration(declaration) ||
				ts.isEnumDeclaration(declaration) ||
				ts.isVariableDeclaration(declaration)),
	);
}

/**
 * @param {EventReference[]} events
 * @returns {Promise<string>}
 */
export async function formatModule(events) {
	const source =
		`// Generated from src/contract/events.ts and src/contract/event-catalog.ts by scripts/generate-contract-reference.mjs. Do not edit.\n\n` +
		`import type { ContractReference } from './events';\n\n` +
		`export const CONTRACT_REFERENCE: ContractReference = ${JSON.stringify({ events })};\n`;
	return format(source, { ...(await resolveConfig(REFERENCE_MODULE)), parser: 'typescript' });
}

/**
 * @param {EventReference[]} events
 * @returns {Promise<string>}
 */
export async function formatPage(events) {
	const sections = events.map(({ channel, description, payloadType, payload }) =>
		[
			`## \`${channel}\``,
			'',
			description,
			'',
			`Payload: \`${payloadType}\``,
			'',
			'```ts',
			payload || `type Payload = ${payloadType};`,
			'```',
		].join('\n'),
	);
	const page = [
		'---',
		'title: Events',
		'description: Every event Malini emits, when it fires, and the TypeScript shape of its payload.',
		'---',
		'',
		'# Events',
		'',
		'Malini announces everything that happens on the platform as an event on a `<domain>:<event>` channel.',
		'A [job](/malini/docs/jobs.md) can start on any of them, and agents inside Malini can list them with the `events_list` tool.',
		'This page is generated from the contract in `apps/malini/src/contract/events.ts`, so it always matches the app.',
		'',
		...sections.flatMap((section) => [section, '']),
	].join('\n');
	return format(page, { ...(await resolveConfig(EVENTS_PAGE)), parser: 'markdown' });
}

/**
 * @param {string} path
 * @param {string} content
 * @param {boolean} check
 * @returns {Promise<void>}
 */
async function update(path, content, check) {
	const existing = await readFile(path, 'utf8').catch(() => '');
	if (existing === content) return;
	if (check) {
		throw new Error(`${path} is stale; run pnpm --filter malini generate:contract-reference`);
	}
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, 'utf8');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const events = readEventReference();
	const check = process.argv.includes('--check');
	await Promise.all([
		update(REFERENCE_MODULE, await formatModule(events), check),
		update(EVENTS_PAGE, await formatPage(events), check),
	]);
}
