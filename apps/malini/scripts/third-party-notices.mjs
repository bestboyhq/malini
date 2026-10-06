import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const NODE_MODULES = '/node_modules/';
const LICENSE_FILE = /^(licen[cs]e|copying|notice)\b/iu;
const SEPARATOR = `\n\n${'-'.repeat(80)}\n\n`;

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
			const notices = noticesFor([...this.getModuleIds(), ...assets]);
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
	const manifest = /** @type {PackageManifest} */ (
		JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
	);
	const license = typeof manifest.license === 'string' ? manifest.license : manifest.license?.type;
	if (!license) throw new Error(`${manifest.name} declares no license; decide before bundling it`);
	const texts = readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isFile() && LICENSE_FILE.test(entry.name))
		.map((entry) => entry.name)
		.sort()
		.map((file) => readFileSync(join(root, file), 'utf8').trim());
	return [`${manifest.name}@${manifest.version}`, `License: ${license}`, ...texts].join('\n\n');
}
