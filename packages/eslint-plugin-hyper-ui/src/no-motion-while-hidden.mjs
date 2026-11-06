export { noMotionWhileHidden };

import { isNonProductFile, maskComments } from './design-system-file-scope.mjs';

/**
 * @type {import('eslint').Rule.RuleMetaData}
 */
const meta = {
	type: 'problem',
	docs: {
		description:
			'Require every Svelte transition to skip its motion while the window is hidden, so what changed while you were away is already there when you come back.',
		recommended: false,
	},
	schema: [],
	messages: {
		motionWhileHidden:
			'"{{directive}}" still runs for what changes while the window is hidden, and all of it plays at once when the window comes back. Read motionOff() from $hyper-ui/motion/motion-off (or motionMs() in the chat) where the motion starts, as in duration: motionOff() ? 0 : 240.',
	},
};

const NOT_MEMBER = String.raw`(?<![\w$]|(?<!\.\.)\.)`;
const HIDDEN_AWARE = new RegExp(
	String.raw`${NOT_MEMBER}(?:motionOff|motionMs)\s*\(|${NOT_MEMBER}document\.hidden(?![\w$])`,
);
const DIRECTIVE =
	/(?<=\s)(?<kind>transition|in|out|animate):(?<name>[A-Za-z_$][\w$]*)(?:\|[\w|]+)*(?<params>=\{)?/g;
const BLOCK = /<(?<tag>script|style)\b[^>]*>[\s\S]*?<\/\k<tag>>/g;
const SCRIPT = /<script\b[^>]*>(?<body>[\s\S]*?)<\/script>/g;
const NAMED_IMPORT = /import\s+(?:type\s+)?\{(?<names>[^}]*)\}\s*from\s*['"](?<source>[^'"]+)['"]/g;
const BUILT_IN_SOURCE = /^svelte\/(?:transition|animate)$/;
const RETURNS_TRANSITION_CONFIG = /\)\s*:\s*TransitionConfig\s*(?:=>\s*\(?\s*)?$/;
const RETURNED_CALL = /(?:\breturn|=>)\s*\(?\s*(?<callee>[A-Za-z_$][\w$]*)\s*\(/g;
const CALL = new RegExp(String.raw`${NOT_MEMBER}(?<callee>[A-Za-z_$][\w$]*)\s*\(`, 'g');
const OPENERS = '{([';
const CLOSERS = '})]';
const QUOTES = `'"\``;

/** @param {string} text */
const blank = (text) => text.replace(/[^\r\n]/g, ' ');

/**
 * @param {string} text
 * @param {number} from
 * @param {(char: string, depth: number) => boolean} stop
 * @returns {number}
 */
const scan = (text, from, stop) => {
	let depth = 0;
	let quote = '';
	for (let index = from; index < text.length; index += 1) {
		const char = text[index] ?? '';
		if (quote !== '') {
			if (char === '\\') index += 1;
			else if (char === quote) quote = '';
			continue;
		}
		if (QUOTES.includes(char)) {
			quote = char;
			continue;
		}
		if (OPENERS.includes(char)) depth += 1;
		if (CLOSERS.includes(char)) depth -= 1;
		if (stop(char, depth)) return index + 1;
	}
	return text.length;
};

/**
 * @param {string} text
 * @param {number} open
 */
const closingOf = (text, open) =>
	scan(text, open, (char, depth) => depth === 0 && CLOSERS.includes(char));

/**
 * @param {string} text
 * @param {number} from
 */
const statementEnd = (text, from) => scan(text, from, (char, depth) => depth === 0 && char === ';');

/**
 * @param {string} script
 * @param {string} name
 * @returns {string | null}
 */
const definitionOf = (script, name) => {
	const escaped = name.replaceAll('$', String.raw`\$`);
	const declaration = new RegExp(
		String.raw`${NOT_MEMBER}(?:(?<fn>function)\s+${escaped}\s*[(<]|(?:const|let)\s+${escaped}(?![\w$]))`,
	).exec(script);
	if (!declaration) return null;
	if (!declaration.groups?.fn)
		return script.slice(declaration.index, statementEnd(script, declaration.index));
	const params = script.indexOf('(', declaration.index);
	const body = script.indexOf('{', closingOf(script, params));
	return body === -1 ? null : script.slice(declaration.index, closingOf(script, body));
};

/**
 * @param {string} text
 * @param {string} script
 * @param {Set<string>} seen
 * @returns {boolean}
 */
const hiddenAware = (text, script, seen) => {
	if (HIDDEN_AWARE.test(text)) return true;
	for (const match of text.matchAll(CALL)) {
		const callee = match.groups?.callee ?? '';
		if (seen.has(callee)) continue;
		seen.add(callee);
		const definition = definitionOf(script, callee);
		if (definition !== null && hiddenAware(definition, script, seen)) return true;
	}
	return false;
};

/**
 * @param {string} script
 * @returns {Map<string, string>}
 */
const importsOf = (script) => {
	const sources = new Map();
	for (const match of script.matchAll(NAMED_IMPORT)) {
		for (const entry of (match.groups?.names ?? '').split(',')) {
			const local =
				entry
					.trim()
					.split(/\s+as\s+/)
					.at(-1)
					?.trim() ?? '';
			if (local !== '' && !local.startsWith('type ')) sources.set(local, match.groups?.source);
		}
	}
	return sources;
};

/**
 * @param {string} definition
 * @param {string} script
 * @param {Set<string>} seen
 */
const motionStopsWhileHidden = (definition, script, seen) => {
	if (hiddenAware(definition, script, seen)) return true;
	const imports = importsOf(script);
	return [...definition.matchAll(RETURNED_CALL)].some((match) => {
		const source = imports.get(match.groups?.callee ?? '');
		return source !== undefined && !BUILT_IN_SOURCE.test(source);
	});
};

/**
 * @param {string} source
 * @returns {Generator<{ index: number, directive: string }>}
 */
function* violations(source) {
	const text = maskComments(source);
	const script = [...text.matchAll(SCRIPT)].map((match) => match.groups?.body ?? '').join('\n;\n');
	const template = text.replace(BLOCK, blank);
	const imports = importsOf(script);
	for (const match of template.matchAll(DIRECTIVE)) {
		const name = match.groups?.name ?? '';
		const index = match.index ?? 0;
		const open = index + match[0].length - 1;
		const params = match.groups?.params ? template.slice(open, closingOf(template, open)) : '';
		const directive = params ? `${match[0]}${params.slice(1)}` : match[0];
		if (params && hiddenAware(params, script, new Set())) continue;
		if (BUILT_IN_SOURCE.test(imports.get(name) ?? '')) {
			yield { index, directive };
			continue;
		}
		const definition = definitionOf(script, name);
		if (definition !== null && !motionStopsWhileHidden(definition, script, new Set([name]))) {
			yield { index, directive };
		}
	}
}

/**
 * @param {import('eslint').Rule.Node} node
 * @returns {string}
 */
const declaredName = (node) =>
	node.type === 'VariableDeclarator' && node.id.type === 'Identifier' ? node.id.name : '';

/**
 * @param {import('eslint').Rule.RuleContext} context
 * @returns {import('eslint').Rule.RuleListener}
 */
const create = (context) => {
	if (isNonProductFile(context.filename)) return {};
	const sourceCode = context.sourceCode;

	if (context.filename.endsWith('.svelte')) {
		return {
			Program(node) {
				for (const violation of violations(sourceCode.getText())) {
					context.report({
						node,
						loc: sourceCode.getLocFromIndex(violation.index),
						messageId: 'motionWhileHidden',
						data: { directive: violation.directive.replace(/\s+/g, ' ') },
					});
				}
			},
		};
	}

	/**
	 * @param {import('eslint').Rule.Node} node
	 * @param {{ range?: [number, number] | undefined }} body
	 * @param {string} name
	 */
	const checkFunction = (node, body, name) => {
		const head = sourceCode.text.slice(node.range?.[0] ?? 0, body.range?.[0] ?? 0);
		if (!RETURNS_TRANSITION_CONFIG.test(head)) return;
		const script = maskComments(sourceCode.getText());
		if (motionStopsWhileHidden(sourceCode.getText(node), script, new Set([name]))) return;
		context.report({
			node,
			messageId: 'motionWhileHidden',
			data: { directive: name || 'this transition' },
		});
	};

	return {
		FunctionDeclaration: (node) => checkFunction(node, node.body, node.id?.name ?? ''),
		FunctionExpression: (node) => checkFunction(node, node.body, declaredName(node.parent)),
		ArrowFunctionExpression: (node) => checkFunction(node, node.body, declaredName(node.parent)),
	};
};

/** @type {import('eslint').Rule.RuleModule} */
const noMotionWhileHidden = { meta, create };
