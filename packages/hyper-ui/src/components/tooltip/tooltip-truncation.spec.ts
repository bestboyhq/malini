import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tooltip } from './tooltip';

const LABEL = 'feature/a-long-workstream-name';
const cleanups: Array<() => void> = [];

function labelAnchor(content: { width?: number; height?: number }): HTMLElement {
	const node = document.createElement('span');
	node.style.overflow = 'hidden';
	node.style.fontSize = '14px';
	node.textContent = LABEL;
	Object.defineProperty(node, 'clientWidth', { value: 120 });
	Object.defineProperty(node, 'scrollWidth', { value: content.width ?? 120 });
	Object.defineProperty(node, 'clientHeight', { value: 16 });
	Object.defineProperty(node, 'scrollHeight', { value: content.height ?? 16 });
	document.body.append(node);
	const action = tooltip(node, { text: LABEL, placement: 'right', onlyWhenTruncated: true });
	cleanups.push(() => {
		node.dispatchEvent(new Event('pointerleave'));
		action.destroy();
		node.remove();
	});
	return node;
}

function describedAfterHover(node: HTMLElement): boolean {
	node.dispatchEvent(new Event('pointerenter'));
	vi.advanceTimersByTime(1000);
	return node.getAttribute('aria-describedby') === 'hyper-tooltip';
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	while (cleanups.length > 0) cleanups.pop()?.();
	vi.advanceTimersByTime(1000);
	vi.useRealTimers();
});

describe('a tooltip that only repeats its label', () => {
	it('stays closed while the label fits', () => {
		expect(describedAfterHover(labelAnchor({}))).toBe(false);
	});

	it('stays closed when only the glyphs overhang the line box', () => {
		expect(describedAfterHover(labelAnchor({ height: 17 }))).toBe(false);
	});

	it('opens once the label is cut off at the end', () => {
		expect(describedAfterHover(labelAnchor({ width: 240 }))).toBe(true);
	});

	it('opens once part of the label wraps onto a hidden line', () => {
		expect(describedAfterHover(labelAnchor({ height: 32 }))).toBe(true);
	});
});
