import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hoverCard = readFileSync(new URL('./HoverCard.svelte', import.meta.url), 'utf8');

describe('hover card interaction wiring', () => {
	it('opens immediately and keeps a forgiving close corridor', () => {
		expect(hoverCard).toContain('openDelay = 0');
		expect(hoverCard).toContain('closeDelay = 150');
	});

	it('positions the mounted portal directly without a deferred visibility gate', () => {
		expect(hoverCard).toMatch(
			/import \{[^}]*\bcalculatePosition\b[^}]*\} from '\.\.\/\.\.\/overlay';/su,
		);
		expect(hoverCard).toContain('const position = calculatePosition(triggerRect, cardRect');
		expect(hoverCard).toContain('cardEl.style.left = `${position.left}px`');
		expect(hoverCard).not.toContain('tick()');
		expect(hoverCard).not.toContain('visibility: hidden');
	});

	it('repositions for content, viewport, and scroll changes', () => {
		expect(hoverCard).toContain('resizeObserver = new ResizeObserver(positionCard)');
		expect(hoverCard).toContain("window.addEventListener('resize', positionCard)");
		expect(hoverCard).toContain("window.addEventListener('scroll', positionCard, true)");
	});

	it('preserves click pinning, backdrop dismissal, and test hooks', () => {
		expect(hoverCard).toContain('togglePinned();');
		expect(hoverCard).toContain('data-hovercard-backdrop');
		expect(hoverCard).toContain('data-testid={backdropTestId}');
		expect(hoverCard).toContain('data-testid={testId}');
		expect(hoverCard).toContain('announceExclusiveOverlayOpen()');
	});
});
