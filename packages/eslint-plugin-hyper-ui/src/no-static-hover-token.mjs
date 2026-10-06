export { noStaticHoverToken };

/**
 * @type {import('eslint').Rule.RuleMetaData}
 */
const meta = {
	type: 'problem',
	docs: {
		description:
			'Disallow -hover color tokens outside interactive state variants. Tokens like surface-100-hover must only appear behind hover, active, focus, group-hover, group-focus, peer-hover, or peer-focus variants.',
		recommended: false,
	},
	schema: [],
	messages: {
		staticHover:
			'"{{token}}" uses a -hover token without an interactive state prefix. Add hover:, active:, focus:, group-hover:, group-focus:, peer-hover:, or peer-focus: — or use a non-hover surface token instead.',
	},
};

const HOVER_TOKEN =
	/\b(?<token>(?:bg|border|text|ring|divide|via|outline|shadow|fill|from|to)-(?:surface|button)-[\w-]*-hover(?:\/\d+)?)\b/g;

/**
 * @param {string} filename
 */
function shouldSkip(filename) {
	const normalized = filename.replace(/\\/g, '/');
	return (
		!normalized.includes('/apps/malini/src/') ||
		normalized.includes('/domain/') ||
		normalized.includes('/lib/paraglide/')
	);
}

/**
 * @param {string} text
 * @param {number} index
 * @returns {boolean}
 */
function hasHoverPrefix(text, index) {
	const before = text.substring(Math.max(0, index - 80), index);
	return /(?:hover|active|focus|focus-within|focus-visible|group-hover[\w/]*|group-focus[\w/]*|peer-hover|peer-focus):$/.test(
		before,
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
			const text = sourceCode.getText();

			for (const match of text.matchAll(HOVER_TOKEN)) {
				const token = match.groups?.token ?? match[0];
				const index = match.index ?? 0;
				if (!hasHoverPrefix(text, index)) {
					context.report({
						node,
						loc: sourceCode.getLocFromIndex(index),
						messageId: 'staticHover',
						data: { token },
					});
				}
			}
		},
	};
};

/** @type {import('eslint').Rule.RuleModule} */
const noStaticHoverToken = {
	meta,
	create,
};
