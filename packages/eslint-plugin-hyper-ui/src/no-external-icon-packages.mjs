export { noExternalIconPackages };

import { isNonProductFile, maskComments, normalizeFilename } from './design-system-file-scope.mjs';

/**
 * @type {import('eslint').Rule.RuleMetaData}
 */
const meta = {
	type: 'problem',
	docs: {
		description:
			'Disallow external icon packages so the local hyper-ui icon set stays the single source of glyphs.',
		recommended: false,
	},
	schema: [],
	messages: {
		externalIconPackage:
			'`{{source}}` is an external icon package. Import the glyph from `$hyper-ui/icons` instead, and draw it with the `draw-icon` skill if the pack does not have it yet.',
	},
};

const BANNED_PACKAGES = new Set([
	'@lucide/svelte',
	'lucide',
	'lucide-svelte',
	'lucide-react',
	'lucide-static',
	'iconify-icon',
	'unplugin-icons',
	'heroicons',
	'phosphor-svelte',
	'feather-icons',
	'bootstrap-icons',
	'boxicons',
	'ionicons',
	'remixicon',
	'simple-icons',
]);

const BANNED_SCOPES = new Set([
	'@iconify',
	'@heroicons',
	'@tabler',
	'@phosphor-icons',
	'@fortawesome',
	'@mdi',
]);

const ALLOWED_ICON_PACKAGES = new Set(['material-icon-theme']);

const IMPORT_SOURCE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"](?<source>[^'"]+)['"]/g;

/** @param {string} source */
const packageNameOf = (source) => {
	const [scope = source, name] = source.split('/');
	if (source.startsWith('@')) {
		return name ? `${scope}/${name}` : scope;
	}
	return scope;
};

/** @param {string} source */
const isBareSpecifier = (source) =>
	!source.startsWith('.') && !source.startsWith('/') && !source.startsWith('$') && source !== '';

/** @param {string} source */
const isBanned = (source) => {
	if (source.startsWith('~icons/')) return true;
	if (!isBareSpecifier(source)) return false;

	const packageName = packageNameOf(source);
	if (ALLOWED_ICON_PACKAGES.has(packageName)) return false;
	if (packageName.startsWith('@malini/')) return false;
	if (BANNED_PACKAGES.has(packageName)) return true;
	if (BANNED_SCOPES.has(packageName.split('/')[0] ?? packageName)) return true;

	return /(?:^|[-@/])icons?(?:$|[-/])/i.test(packageName);
};

/**
 * @param {import('eslint').Rule.RuleContext} context
 * @returns {import('eslint').Rule.RuleListener}
 */
const create = (context) => {
	const filename = normalizeFilename(context.filename);
	if (isNonProductFile(filename)) return {};

	return {
		Program(node) {
			const sourceCode = context.sourceCode;
			const text = maskComments(sourceCode.getText());
			for (const match of text.matchAll(IMPORT_SOURCE)) {
				const source = match.groups?.source ?? '';
				if (!isBanned(source)) continue;

				context.report({
					node,
					loc: sourceCode.getLocFromIndex(match.index ?? 0),
					messageId: 'externalIconPackage',
					data: { source },
				});
			}
		},
	};
};

/** @type {import('eslint').Rule.RuleModule} */
const noExternalIconPackages = { meta, create };
