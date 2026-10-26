import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE_MODULES = '/node_modules/';
const LICENSE_FILE = /^(licen[cs]e|copying|notice)\b/iu;
const SEPARATOR = `\n\n${'-'.repeat(80)}\n\n`;
const NOTICE = fileURLToPath(new URL('../../../NOTICE', import.meta.url));

/**
 * @typedef {object} PackageManifest
 * @property {string} name
 * @property {string} version
 * @property {string | { type?: string }} [license]
 */

/**
 * @returns {import('vite').Plugin}
 */
export function thirdPartyNotices() {
	let root = '';
	return {
		name: 'malini:third-party-notices',
		apply: 'build',
		configResolved(config) {
			root = config.root;
		},
		generateBundle(_options, bundle) {
			const assets = Object.values(bundle).flatMap((file) =>
				file.type === 'asset' ? file.originalFileNames.map((name) => resolve(root, name)) : [],
			);
			const moduleIds = [...this.getModuleIds(), ...assets];
			const unlisted = unlistedIn(readFileSync(NOTICE, 'utf8'), moduleIds);
			if (unlisted.length > 0) {
				throw new Error(`NOTICE does not list ${unlisted.join(', ')}; add each with its license`);
			}
			const notices = noticesFor(moduleIds);
			if (!notices) return;
			this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt', source: notices });
		},
	};
}

/**
 * @param {readonly string[]} moduleIds
 * @returns {string}
 */
export function noticesFor(moduleIds) {
	const roots = new Set(moduleIds.flatMap((id) => packageRoot(id) ?? []));
	return [...roots].map(notice).sort().join(SEPARATOR);
}

/**
 * @param {string} notice
 * @param {readonly string[]} moduleIds
 * @returns {string[]}
 */
export function unlistedIn(notice, moduleIds) {
	const listed = new Set(notice.split('\n').map((line) => line.split(' ')[0]));
	const roots = new Set(moduleIds.flatMap((id) => packageRoot(id) ?? []));
	return [...roots].map((root) => manifestOf(root).name).filter((name) => !listed.has(name));
}

/**
 * @param {string} id
 * @returns {string | undefined}
 */
function packageRoot(id) {
	const path = id.replace(/^\0/u, '').split('?')[0] ?? '';
	const start = path.lastIndexOf(NODE_MODULES);
	if (start === -1) return undefined;
	const [scope = '', name = ''] = path.slice(start + NODE_MODULES.length).split('/');
	return (
		path.slice(0, start + NODE_MODULES.length) +
		(scope.startsWith('@') ? `${scope}/${name}` : scope)
	);
}

/**
 * @param {string} root
 * @returns {string}
 */
function notice(root) {
	const manifest = manifestOf(root);
	const license = typeof manifest.license === 'string' ? manifest.license : manifest.license?.type;
	if (!license) throw new Error(`${manifest.name} declares no license; decide before bundling it`);
	const texts = readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isFile() && LICENSE_FILE.test(entry.name))
		.map((entry) => entry.name)
		.sort()
		.map((file) => readFileSync(join(root, file), 'utf8').trim());
	return [`${manifest.name}@${manifest.version}`, `License: ${license}`, ...texts].join('\n\n');
}

/**
 * @param {string} root
 * @returns {PackageManifest}
 */
function manifestOf(root) {
	return /** @type {PackageManifest} */ (
		JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
	);
}
