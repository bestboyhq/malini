export { noLiteralProductColors };

import {
	isNonProductFile,
	isSharedUiImplementation,
	maskComments,
} from './design-system-file-scope.mjs';

/**
 * @type {import('eslint').Rule.RuleMetaData}
 */
const meta = {
	type: 'problem',
	docs: {
		description:
			'Disallow literal colors in product feature UI so visual values come from the desktop design-token system.',
		recommended: false,
	},
	schema: [],
	messages: {
		literalColor:
			'Do not use a literal color in product UI. Add or use a semantic design token instead.',
	},
};

const LITERAL_COLOR = /#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\s*\(/gi;

/**
 * @param {import('eslint').Rule.RuleContext} context
 * @returns {import('eslint').Rule.RuleListener}
 */
const create = (context) => {
	const filename = context.filename;
	if (isNonProductFile(filename) || isSharedUiImplementation(filename)) return {};

	return {
		Program(node) {
			const sourceCode = context.sourceCode;
			const text = maskComments(sourceCode.getText());
			for (const match of text.matchAll(LITERAL_COLOR)) {
				context.report({
					node,
					loc: sourceCode.getLocFromIndex(match.index ?? 0),
					messageId: 'literalColor',
				});
			}
		},
	};
};

/** @type {import('eslint').Rule.RuleModule} */
const noLiteralProductColors = { meta, create };
