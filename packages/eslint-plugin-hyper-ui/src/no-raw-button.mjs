export { noRawButton };

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
			'Require product UI to build clickable controls from the hyper-ui Button and IconButton primitives rather than a raw `<button>` element.',
		recommended: false,
	},
	schema: [],
	messages: {
		rawButton:
			'Use `Button` from `$hyper-ui/components/button` or `IconButton` from `$hyper-ui/components/icon-button` instead of a raw `<button>`. Look at them in the gallery at `/dev/hyper-ui`. If this control genuinely cannot be one of them, suppress `@malini/desktop/no-raw-button` on the line with the reason.',
	},
};

const RAW_BUTTON = /<button(?=[\s/>])/g;

/**
 * @param {import('eslint').Rule.RuleContext} context
 * @returns {import('eslint').Rule.RuleListener}
 */
const create = (context) => {
	const filename = context.filename;
	if (!filename.endsWith('.svelte')) return {};
	if (isNonProductFile(filename) || isSharedUiImplementation(filename)) return {};

	return {
		Program(node) {
			const sourceCode = context.sourceCode;
			const text = maskComments(sourceCode.getText());
			for (const match of text.matchAll(RAW_BUTTON)) {
				context.report({
					node,
					loc: sourceCode.getLocFromIndex(match.index ?? 0),
					messageId: 'rawButton',
				});
			}
		},
	};
};

/** @type {import('eslint').Rule.RuleModule} */
const noRawButton = { meta, create };
