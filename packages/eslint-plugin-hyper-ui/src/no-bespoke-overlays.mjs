export { noBespokeOverlays };

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
			'Require desktop modal and anchored overlay surfaces to use the shared UI primitives.',
		recommended: false,
	},
	schema: [
		{
			type: 'object',
			properties: {
				allowSurfaceTestIds: {
					type: 'array',
					items: { type: 'string' },
					uniqueItems: true,
				},
			},
			additionalProperties: false,
		},
	],
	messages: {
		bespokeOverlay:
			'Do not build a bespoke full-viewport overlay. Use Modal, Sheet, Popover, or DropdownLayer from `$hyper-ui/components/<name>`.',
		bespokeTooltip:
			'Do not build a product-local tooltip surface. Use Tooltip from `$hyper-ui/components/tooltip`.',
		bespokePortal:
			'Do not portal a product overlay directly. Use HoverCard or DropdownLayer from `$hyper-ui/components/<name>` so stacking and dismissal stay standardized.',
		bespokeScroller:
			'Do not implement custom scrollbar styling in a product surface. Use ScrollableDiv from `$hyper-ui/components/scrollable-div`.',
		unmanagedInteractiveSurface:
			'Dialog, menu, and listbox surfaces must be hosted by Modal, Sheet, Popover, HoverCard, Dropdown, or DropdownLayer from `$hyper-ui/components/<name>` so focus, backdrop, stacking, and dismissal behavior stay standardized.',
		nativePopover:
			'Do not use the native popover API directly. Use Popover or DropdownLayer from `$hyper-ui/components/<name>` so tooltip suppression, stacking, and dismissal stay coordinated.',
	},
};

const BESPOKE_OVERLAY =
	/<(?:div|section)\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bfixed\b[^"']*["'])(?=[^>]*\bclass\s*=\s*["'][^"']*\binset-0\b[^"']*["'])(?=[^>]*(?:\brole\s*=\s*["'](?:dialog|menu|listbox|presentation)["']|\baria-modal\s*=))[^>]*>/gms;
const BESPOKE_TOOLTIP = /<[a-z][a-z0-9:-]*\b[^>]*\brole\s*=\s*["']tooltip["'][^>]*>/gms;
const DIRECT_PORTAL = /\b(?:use:bodyPortal|data-overlay-portal)\b/g;
const CUSTOM_SCROLLBAR = /::-(?:webkit-)?scrollbar|\bscrollbar-(?:width|color)\s*:/g;
const INTERACTIVE_SURFACE_ROLE =
	/<[a-z][a-z0-9:-]*\b[^>]*\brole\s*=\s*["'](?:dialog|menu|listbox)["'][^>]*>/gms;
const MANAGED_SURFACE = /<(?:Modal|Sheet|FullPageModal|Popover|HoverCard|Dropdown|DropdownLayer)\b/;
const NATIVE_POPOVER =
	/(?<![\w-])(?:popover(?=\s|=|\/?>)|popovertarget\s*=)|\.(?:showPopover|hidePopover|togglePopover)\s*\(/g;

/**
 * @typedef {object} Options
 * @property {string[]} [allowSurfaceTestIds]
 */

/**
 * @param {import('eslint').Rule.RuleContext} context
 * @returns {import('eslint').Rule.RuleListener}
 */
const create = (context) => {
	const filename = context.filename;
	if (isNonProductFile(filename) || isSharedUiImplementation(filename)) {
		return {};
	}
	/** @type {Options | undefined} */
	const options = context.options[0];
	const allowedSurfaceTestIds = new Set(options?.allowSurfaceTestIds ?? []);

	return {
		Program(node) {
			const sourceCode = context.sourceCode;
			const text = maskComments(sourceCode.getText());

			/** @type {ReadonlyArray<readonly [RegExp, string]>} */
			const patterns = [
				[BESPOKE_OVERLAY, 'bespokeOverlay'],
				[BESPOKE_TOOLTIP, 'bespokeTooltip'],
				[DIRECT_PORTAL, 'bespokePortal'],
				[CUSTOM_SCROLLBAR, 'bespokeScroller'],
				[NATIVE_POPOVER, 'nativePopover'],
			];

			for (const [pattern, messageId] of patterns) {
				for (const match of text.matchAll(pattern)) {
					context.report({
						node,
						loc: sourceCode.getLocFromIndex(match.index ?? 0),
						messageId,
					});
				}
			}

			if (!MANAGED_SURFACE.test(text)) {
				for (const match of text.matchAll(INTERACTIVE_SURFACE_ROLE)) {
					const markup = match[0] ?? '';
					const isAllowedMigrationSurface = [...allowedSurfaceTestIds].some((testId) =>
						new RegExp(`\\bdata-testid\\s*=\\s*["']${escapeRegex(testId)}["']`).test(markup),
					);
					if (isAllowedMigrationSurface) continue;
					context.report({
						node,
						loc: sourceCode.getLocFromIndex(match.index ?? 0),
						messageId: 'unmanagedInteractiveSurface',
					});
				}
			}
		},
	};
};

/** @param {string} value */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** @type {import('eslint').Rule.RuleModule} */
const noBespokeOverlays = { meta, create };
