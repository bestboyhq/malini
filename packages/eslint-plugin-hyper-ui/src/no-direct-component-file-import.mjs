export { noDirectComponentFileImport };

import {
	isNonProductFile,
	isSharedUiImplementation,
	maskComments,
	normalizeFilename,
} from './design-system-file-scope.mjs';

/**
 * @type {import('eslint').Rule.RuleMetaData}
 */
const meta = {
	type: 'problem',
	docs: {
		description:
			'Require hyper-ui components to be imported through their folder module rather than by a direct `.svelte` file path.',
		recommended: false,
	},
	schema: [],
	messages: {
		directComponentFile:
			'Import `{{module}}` from `$hyper-ui/components/{{folder}}`, not the `.svelte` file inside it. The folder module is what the package exports, so it is the only spelling that survives a component being split or renamed.',
	},
};

const PACKAGE_COMPONENT_FILE =
	/(?:\$hyper-ui|@malini\/hyper-ui)\/components\/(?<folder>[^/'"]+)\/(?<file>[^'"]*\.svelte)/;
const RELATIVE_COMPONENT_FILE =
	/packages\/hyper-ui\/src\/components\/(?<folder>[^/'"]+)\/(?<file>[^'"]*\.svelte)/;

const IMPORT_SOURCE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"](?<source>[^'"]+)['"]/g;

/** @param {string} source */
const componentFileIn = (source) =>
	source.match(PACKAGE_COMPONENT_FILE) ?? source.match(RELATIVE_COMPONENT_FILE);

/**
 * @param {import('eslint').Rule.RuleContext} context
 * @returns {import('eslint').Rule.RuleListener}
 */
const create = (context) => {
	const filename = normalizeFilename(context.filename);
	if (isNonProductFile(filename) || isSharedUiImplementation(filename)) return {};

	return {
		Program(node) {
			const sourceCode = context.sourceCode;
			const text = maskComments(sourceCode.getText());
			for (const match of text.matchAll(IMPORT_SOURCE)) {
				const source = match.groups?.source ?? '';
				const componentFile = componentFileIn(source);
				if (!componentFile) continue;

				context.report({
					node,
					loc: sourceCode.getLocFromIndex(match.index ?? 0),
					messageId: 'directComponentFile',
					data: {
						folder: componentFile.groups?.folder ?? '',
						module: (componentFile.groups?.file ?? '').replace(/\.svelte$/, ''),
					},
				});
			}
		},
	};
};

/** @type {import('eslint').Rule.RuleModule} */
const noDirectComponentFileImport = { meta, create };
