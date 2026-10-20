export { noNativeTitleAttributes };

import { isNonProductFile, maskComments } from './design-system-file-scope.mjs';

/**
 * @type {import('eslint').Rule.RuleMetaData}
 */
const meta = {
	type: 'problem',
	docs: {
		description:
			'Disallow native HTML title hover help in desktop product UI; use accessible shared Tooltip or HoverCard primitives.',
		recommended: false,
	},
	schema: [],
	messages: {
		nativeTitle:
			'Do not use a native `title` attribute for hover help. Give the control an accessible name and use Tooltip or HoverCard from `$hyper-ui/components/<name>`.',
		programmaticTitle:
			'Do not create a native title tooltip with `setAttribute`. Use Tooltip or HoverCard from `$hyper-ui/components/<name>`.',
	},
};

const NATIVE_TITLE_ATTRIBUTE_TAG_ALLOWLIST = new Set(['iframe']);
const NATIVE_TAG_WITH_TITLE =
	/<(?<tag>[a-z][a-z0-9:-]*)\b(?<attributes>[^>]*?(?:\btitle\s*=|(?<!\S)\{\s*title\s*\}))[^>]*>/gms;
const PROGRAMMATIC_NATIVE_TITLE = /\.setAttribute\s*\(\s*(['"])title\1\s*,/g;
const PROGRAMMATIC_NATIVE_TITLE_NS =
	/\.setAttributeNS\s*\(\s*(?:null|undefined)\s*,\s*(['"])title\1\s*,/g;

/**
 * @param {import('eslint').Rule.RuleContext} context
 * @returns {import('eslint').Rule.RuleListener}
 */
const create = (context) => {
	const filename = context.filename;
	if (isNonProductFile(filename)) return {};

	return {
		Program(node) {
			const sourceCode = context.sourceCode;
			const text = maskComments(sourceCode.getText());

			for (const match of text.matchAll(NATIVE_TAG_WITH_TITLE)) {
				if (NATIVE_TITLE_ATTRIBUTE_TAG_ALLOWLIST.has(match.groups?.tag ?? '')) continue;
				const titleOffset = match[0]?.lastIndexOf('title') ?? 0;
				context.report({
					node,
					loc: sourceCode.getLocFromIndex((match.index ?? 0) + titleOffset),
					messageId: 'nativeTitle',
				});
			}

			for (const pattern of [PROGRAMMATIC_NATIVE_TITLE, PROGRAMMATIC_NATIVE_TITLE_NS]) {
				for (const match of text.matchAll(pattern)) {
					context.report({
						node,
						loc: sourceCode.getLocFromIndex(match.index ?? 0),
						messageId: 'programmaticTitle',
					});
				}
			}
		},
	};
};

/** @type {import('eslint').Rule.RuleModule} */
const noNativeTitleAttributes = { meta, create };
