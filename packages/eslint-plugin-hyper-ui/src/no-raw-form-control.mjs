export { noRawFormControl };

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
			'Require product UI to build form controls from the hyper-ui input primitives rather than raw `<input>`, `<textarea>` or `<select>` elements.',
		recommended: false,
	},
	schema: [],
	messages: {
		rawFormControl:
			'Use {{replacement}} instead of a raw `<{{tag}}>`. Look at the form tier in the gallery at `/dev/hyper-ui`. If this control genuinely cannot be one of them, suppress `@malini/desktop/no-raw-form-control` on the line with the reason.',
	},
};

/** @type {Readonly<Record<string, string>>} */
const REPLACEMENTS = {
	input:
		'`TextInput` from `$hyper-ui/components/text-input`, `Checkbox` from `$hyper-ui/components/checkbox` or `Switch` from `$hyper-ui/components/switch`',
	textarea: '`Textarea` from `$hyper-ui/components/textarea`',
	select: '`Select` from `$hyper-ui/components/select`',
};

const RAW_FORM_CONTROL = /<(?<tag>input|textarea|select)(?=[\s/>])/g;

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
			for (const match of text.matchAll(RAW_FORM_CONTROL)) {
				const tag = match.groups?.tag ?? '';
				const replacement = REPLACEMENTS[tag];
				if (replacement === undefined) continue;
				context.report({
					node,
					loc: sourceCode.getLocFromIndex(match.index ?? 0),
					messageId: 'rawFormControl',
					data: { tag, replacement },
				});
			}
		},
	};
};

/** @type {import('eslint').Rule.RuleModule} */
const noRawFormControl = { meta, create };
