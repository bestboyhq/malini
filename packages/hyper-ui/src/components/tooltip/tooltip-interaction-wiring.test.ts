import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tooltipSource = readFileSync(new URL('./Tooltip.svelte', import.meta.url), 'utf8');
const warmupSource = readFileSync(new URL('./tooltip-warmup.ts', import.meta.url), 'utf8');
const exclusivitySource = readFileSync(
	new URL('./tooltip-exclusivity.ts', import.meta.url),
	'utf8',
);

describe('tooltip interaction wiring', () => {
	it('keeps the hover-intent delays that decide whether help appears at all', () => {
		expect(warmupSource).toContain('const INITIAL_DELAY = 180;');
		expect(warmupSource).toContain('const WARM_DELAY = 30;');
		expect(warmupSource).toContain('const COOLDOWN = 1500;');
	});

	it('arms the entrance before showing it on the following animation frame', () => {
		expect(tooltipSource).toMatch(
			/entranceRaf = requestAnimationFrame\(\(\) => \{\s*armed = true;\s*entranceRaf = requestAnimationFrame\(\(\) => \{\s*entranceRaf = null;\s*shown = true;/u,
		);
	});

	it('answers pointer, keyboard focus and click on the trigger', () => {
		expect(tooltipSource).toContain("on(wrapper, 'mouseenter', show),");
		expect(tooltipSource).toContain("on(wrapper, 'mouseleave', onTriggerMouseLeave),");
		expect(tooltipSource).toContain("on(wrapper, 'focusin', show),");
		expect(tooltipSource).toContain("on(wrapper, 'focusout', onTriggerFocusOut),");
		expect(tooltipSource).toContain("on(wrapper, 'click', onTriggerClick),");
		expect(tooltipSource).toContain("on(document, 'click', onDocumentClick),");
		expect(tooltipSource).toContain("role={isSnippetContent ? 'group' : 'tooltip'}");
		expect(tooltipSource).toContain('ids.add(tooltipId);');
	});

	it('positions the body portal from the trigger and flips at viewport edges', () => {
		expect(tooltipSource).toContain('use:bodyPortal');
		expect(tooltipSource).toContain('tooltipZIndex = resolveOverlayZIndex(wrapper);');
		expect(tooltipSource).toContain('const triggerRect = wrapper.getBoundingClientRect();');
		expect(tooltipSource).toContain("if (placement === 'top') effectivePlacement = 'bottom';");
		expect(tooltipSource).toContain("if (placement === 'bottom') effectivePlacement = 'top';");
	});

	it('allows only one hover tooltip owner and still suppresses help under menus', () => {
		expect(tooltipSource).toContain("if (trigger === 'hover') claimHoverTooltip(hideImmediate);");
		expect(tooltipSource).toContain('if (suppressed || isExclusiveOverlayActive(wrapper))');
		expect(tooltipSource).toContain(
			"'[data-dropdown-portal], [data-hovercard-portal], [data-overlay-portal]'",
		);
		expect(tooltipSource).toContain('releaseHoverTooltip(hideImmediate);');
		expect(exclusivitySource).toContain('previous?.();');
	});
});
