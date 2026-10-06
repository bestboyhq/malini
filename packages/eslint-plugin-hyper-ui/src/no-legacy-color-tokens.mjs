export { noLegacyColorTokens };

import { maskComments } from './design-system-file-scope.mjs';

/**
 * @type {import('eslint').Rule.RuleMetaData}
 */
const meta = {
	type: 'problem',
	docs: {
		description:
			'Disallow legacy DaisyUI/generic color tokens in desktop code. Use the semantic color-token decision tree instead.',
		recommended: false,
	},
	schema: [],
	messages: {
		legacyColor:
			'Legacy color token "{{token}}" is not allowed. Use the semantic color-token decision tree in apps/malini/src/renderer/src/styles/.',
	},
};

const LEGACY_COLOR_TOKEN =
	/\b(?<token>(?:bg|text|border|fill)-?(?:base-(?:100|200|300|content)|root-bg|neutral-(?:50|100|150|200|300|400|500))|(?:base-(?:100|200|300|content)|root-bg|neutral-(?:50|100|150|200|300|400|500))|(?:bg|text)-surface-(?:100|elevated|modal|tooltip|input)-border|bg-surface-[2-9]\d{2}|(?:bg|text|border|fill)-(?:grey|gray|red|orange|yellow|green|blue|pink|purple)-\d{2,3})\b/g;

const LEGACY_DAISYUI_TOKEN =
	/(?<![-\w])(?<token>btn(?:-(?:primary|ghost|outline|link|xs|sm|md|lg|wide|block|square|info|success|warning|error|accent|neutral|active|disabled))?)(?![-\w])/g;

/**
 * @param {string} filename
 */
function getNormalizedFilename(filename) {
	return filename.replace(/\\/g, '/');
}

/**
 * @param {string} filename
 */
function shouldSkip(filename) {
	const normalized = getNormalizedFilename(filename);
	return (
		!normalized.includes('/apps/malini/src/') ||
		normalized.includes('/apps/malini/src/routes/styles/') ||
		normalized.includes('/domain/') ||
		normalized.includes('/lib/paraglide/')
	);
}

/**
 * @param {import('eslint').Rule.RuleContext} context
 * @returns {import('eslint').Rule.RuleListener}
 */
const create = (context) => {
	const filename = context.filename;
	if (shouldSkip(filename)) {
		return {};
	}

	return {
		Program(node) {
			const sourceCode = context.sourceCode;
			const text = maskComments(sourceCode.getText());

			for (const pattern of [LEGACY_COLOR_TOKEN, LEGACY_DAISYUI_TOKEN]) {
				for (const match of text.matchAll(pattern)) {
					const token = match.groups?.token ?? match[0];
					const index = match.index ?? 0;
					context.report({
						node,
						loc: sourceCode.getLocFromIndex(index),
						messageId: 'legacyColor',
						data: { token },
					});
				}
			}
		},
	};
};

/** @type {import('eslint').Rule.RuleModule} */
const noLegacyColorTokens = {
	meta,
	create,
};
