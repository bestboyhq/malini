export { noBorderTokenBackground };

/**
 * @type {import('eslint').Rule.RuleMetaData}
 */
const meta = {
	type: 'problem',
	docs: {
		description:
			'Disallow border-* color tokens with background utilities. Border tokens must be used with border/ring/divide-style utilities, not bg-*.',
		recommended: false,
	},
	schema: [],
	messages: {
		borderBackground:
			'"{{token}}" is not allowed. border-* tokens are for border-like utilities; use border-border-* for divider borders or a surface token for backgrounds.',
	},
};

const BORDER_BACKGROUND_TOKEN = /\b(?<token>bg-border-[\w-]+(?:\/\d+)?)\b/g;

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

			for (const match of text.matchAll(BORDER_BACKGROUND_TOKEN)) {
				const token = match.groups?.token ?? match[0];
				const index = match.index ?? 0;
				context.report({
					node,
					loc: sourceCode.getLocFromIndex(index),
					messageId: 'borderBackground',
					data: { token },
				});
			}
		},
	};
};

/** @type {import('eslint').Rule.RuleModule} */
const noBorderTokenBackground = {
	meta,
	create,
};
