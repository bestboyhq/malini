export { preferHyperUiEntrypoint };

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
			'Require every public hyper-ui component to be imported through its folder module.',
		recommended: false,
	},
	schema: [],
	messages: {
		directPrimitive:
			'Import {{primitive}} from `$hyper-ui/components/{{module}}` so shared behavior stays standardized.',
		shadowPrimitive:
			'Do not define a product-local {{primitive}} component. Extend the shared primitive in `packages/hyper-ui/src/components` and export it from its folder module.',
	},
};

/** @type {ReadonlyMap<string, string>} */
const PRIMITIVE_MODULES = new Map([
	['Autocomplete', 'autocomplete'],
	['Avatar', 'avatar'],
	['Badge', 'badge'],
	['Button', 'button'],
	['Checkbox', 'checkbox'],
	['ColorPicker', 'color-picker'],
	['ComposerShell', 'composer-shell'],
	['Dropdown', 'dropdown'],
	['DropdownItem', 'dropdown'],
	['DropdownLayer', 'dropdown-layer'],
	['EmptyState', 'empty-state'],
	['FileTypeIcon', 'file-type-icon'],
	['FullPageModal', 'full-page-modal'],
	['GuardFallback', 'guard-fallback'],
	['HoverCard', 'hover-card'],
	['IconButton', 'icon-button'],
	['LoadingCircle', 'loading-circle'],
	['Modal', 'modal'],
	['Popover', 'popover'],
	['PresenceDot', 'presence-dot'],
	['ProBadge', 'pro-badge'],
	['ResizableSplit', 'resizable-split'],
	['ScrollableDiv', 'scrollable-div'],
	['Select', 'select'],
	['Sheet', 'sheet'],
	['Skeleton', 'skeleton'],
	['StatusPill', 'status-pill'],
	['SurfaceCard', 'surface-card'],
	['Switch', 'switch'],
	['TextInput', 'text-input'],
	['Textarea', 'textarea'],
	['Toast', 'toast'],
	['ToastHost', 'toast'],
	['Tooltip', 'tooltip'],
]);
const SHARED_PRIMITIVES = [...PRIMITIVE_MODULES.keys()];
const FORBIDDEN_SHADOW_PRIMITIVES = new Set(SHARED_PRIMITIVES);

/** @param {string} module */
const entrypointsFor = (module) => [
	`$hyper-ui/components/${module}`,
	`@malini/hyper-ui/components/${module}`,
];

const IMPORT_OR_EXPORT =
	/(?:^|[;\r\n])(?<statement>[ \t]*(?:import|export)\s+(?<clause>[\s\S]*?)\s+from\s*['"](?<source>[^'"]+)['"])/gm;

const TYPE_ONLY_MEMBER = new RegExp(`\\btype\\s+(?:${SHARED_PRIMITIVES.join('|')})\\b`, 'g');

/** @param {string} source */
const primitiveFromSource = (source) =>
	SHARED_PRIMITIVES.find((primitive) => new RegExp(`(?:^|/)${primitive}\\.svelte$`).test(source));

/** @param {string} clause */
const primitivesFromClause = (clause) => {
	if (/^\s*type\b/.test(clause)) return [];
	const valueClause = clause.replace(TYPE_ONLY_MEMBER, '');
	return SHARED_PRIMITIVES.map((primitive) => ({
		primitive,
		at: valueClause.search(new RegExp(`\\b${primitive}\\b`)),
	}))
		.filter(({ at }) => at >= 0)
		.sort((left, right) => left.at - right.at)
		.map(({ primitive }) => primitive);
};

/**
 * @param {import('eslint').Rule.RuleContext} context
 * @returns {import('eslint').Rule.RuleListener}
 */
const create = (context) => {
	const filename = normalizeFilename(context.filename);
	if (isNonProductFile(filename) || isSharedUiImplementation(filename)) {
		return {};
	}

	return {
		Program(node) {
			const sourceCode = context.sourceCode;
			const basename = filename
				.split('/')
				.at(-1)
				?.replace(/\.svelte$/, '');
			if (basename && FORBIDDEN_SHADOW_PRIMITIVES.has(basename)) {
				context.report({
					node,
					messageId: 'shadowPrimitive',
					data: { primitive: basename },
				});
				return;
			}

			const text = maskComments(sourceCode.getText());
			for (const match of text.matchAll(IMPORT_OR_EXPORT)) {
				const source = match.groups?.source ?? '';

				const directPrimitive = primitiveFromSource(source);
				const primitives = directPrimitive
					? [directPrimitive]
					: primitivesFromClause(match.groups?.clause ?? '');

				for (const primitive of new Set(primitives)) {
					const module = PRIMITIVE_MODULES.get(primitive);
					if (module === undefined) continue;
					if (!directPrimitive && entrypointsFor(module).includes(source)) continue;

					context.report({
						node,
						loc: sourceCode.getLocFromIndex(
							(match.index ?? 0) + (match[0]?.indexOf(match.groups?.statement ?? '') ?? 0),
						),
						messageId: 'directPrimitive',
						data: { primitive, module },
					});
				}
			}
		},
	};
};

/** @type {import('eslint').Rule.RuleModule} */
const preferHyperUiEntrypoint = { meta, create };
