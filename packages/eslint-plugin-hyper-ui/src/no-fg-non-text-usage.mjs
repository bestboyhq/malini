export { noFgNonTextUsage };

/**
 * @type {import('eslint').Rule.RuleMetaData}
 */
const meta = {
	type: 'problem',
	docs: {
		description:
			'Disallow fg-* color tokens with non-text utilities. fg-* tokens are foreground tokens meant exclusively for text-* usage.',
		recommended: false,
	},
	schema: [],
	messages: {
		fgNonText:
			'"{{token}}" is not allowed. fg-* tokens are text-only — use text-fg-* instead of {{utility}}-fg-*. For backgrounds use surface-* tokens, for borders use border-* tokens.',
	},
};

const FG_NON_TEXT =
	/\b(?<token>(?:bg|border|ring|divide|via|outline|shadow|fill|stroke|from|to|decoration|accent|caret)-fg-[\w-]+)\b/g;

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

			for (const match of text.matchAll(FG_NON_TEXT)) {
				const token = match.groups?.token ?? match[0];
				const utility = token.split('-fg-')[0] ?? token;
				const index = match.index ?? 0;
				context.report({
					node,
					loc: sourceCode.getLocFromIndex(index),
					messageId: 'fgNonText',
					data: { token, utility },
				});
			}
		},
	};
};

/** @type {import('eslint').Rule.RuleModule} */
const noFgNonTextUsage = {
	meta,
	create,
};
