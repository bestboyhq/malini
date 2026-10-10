import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dropdown = readFileSync(new URL('./Dropdown.svelte', import.meta.url), 'utf8');
const item = readFileSync(new URL('./DropdownItem.svelte', import.meta.url), 'utf8');
const layer = readFileSync(
	new URL('../dropdown-layer/DropdownLayer.svelte', import.meta.url),
	'utf8',
);
const roving = readFileSync(new URL('../../overlay/focus.ts', import.meta.url), 'utf8');

describe('dropdown open and selection wiring', () => {
	it('opens directly in the trigger click without a timer or deferred task', () => {
		const triggerClick = dropdown.match(/function onTriggerClick[\s\S]*?\n\t\}/u)?.[0] ?? '';
		expect(triggerClick).toContain('toggle()');
		expect(triggerClick).not.toMatch(/setTimeout|queueMicrotask|requestAnimationFrame/u);
	});

	it('positions the mounted surface synchronously instead of hiding it behind a tick', () => {
		expect(layer).toContain('if (!open || !panelEl) return;');
		expect(layer).toContain('positionCard();');
		expect(layer).toContain('use:mountPanel');
		expect(layer).toContain('panelEl.style.top = `${position.top}px`');
		expect(layer).toContain('panelEl.style.left = `${position.left}px`');
		expect(layer).toContain('width: panelEl.offsetWidth');
		expect(layer).toContain('height: panelEl.offsetHeight');
		expect(layer).not.toContain(
			'calculatePosition(trigger.getBoundingClientRect(), panelEl.getBoundingClientRect()',
		);
		expect(layer).not.toContain('setProvisionalPosition');
		expect(layer).not.toContain("positioned ? 'visible' : 'invisible'");
		expect(layer).not.toMatch(/tick\(\)\.then\(\(\) => \{[\s\S]*calculatePosition/u);
	});

	it('anchors to the rendered control and owns its persistent open state', () => {
		expect(dropdown).toContain("data-state={open ? 'open' : 'closed'}");
		expect(dropdown).not.toContain('role="button"');
		expect(dropdown).not.toContain('tabindex="0"');
		expect(layer).toContain(
			'\'[data-dropdown-anchor], [data-hyper-button], button, a[href], input, [role="button"]\'',
		);
		expect(layer).toContain('const trigger = triggerElement();');
		expect(layer).toContain("trigger.setAttribute('data-dropdown-open', 'true')");
		expect(layer).toContain("trigger.removeAttribute('data-dropdown-open')");
	});

	it('matches the reference outside-click, keyboard, and hover-focus behavior', () => {
		expect(layer).toContain('shouldCloseDropdownFromDocumentClick');
		expect(layer).toContain('roving.handleArrowKeys(event)');
		expect(roving).toContain("event.key === 'ArrowDown'");
		expect(layer).toContain('registerEscapeScope(requestClose)');
		expect(item).toContain('focusOnHover = true');
		expect(item).toContain('event.currentTarget.focus({ preventScroll: true })');
	});

	it('routes selection through the shared menu tree close, which animates the menu out', () => {
		expect(item).toContain('tree?.closeAll()');
		expect(layer).toContain('out:menuClose|global={{ side: actualSide, align }}');
	});
});
