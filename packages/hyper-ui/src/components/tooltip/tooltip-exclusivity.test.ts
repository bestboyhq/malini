import { describe, expect, it, vi } from 'vitest';

import {
	claimHoverTooltip,
	dismissActiveHoverTooltip,
	releaseHoverTooltip,
} from './tooltip-exclusivity';

describe('hover tooltip exclusivity', () => {
	it('dismisses the previous tooltip synchronously when ownership changes', () => {
		const first = vi.fn();
		const second = vi.fn();

		claimHoverTooltip(first);
		claimHoverTooltip(second);

		expect(first).toHaveBeenCalledOnce();
		expect(second).not.toHaveBeenCalled();
		releaseHoverTooltip(second);
	});

	it('does not dismiss a tooltip when it reclaims its own ownership', () => {
		const dismiss = vi.fn();

		claimHoverTooltip(dismiss);
		claimHoverTooltip(dismiss);

		expect(dismiss).not.toHaveBeenCalled();
		releaseHoverTooltip(dismiss);
	});

	it('does not let a stale tooltip release the current owner', () => {
		const first = vi.fn();
		const second = vi.fn();
		const third = vi.fn();

		claimHoverTooltip(first);
		claimHoverTooltip(second);
		releaseHoverTooltip(first);
		claimHoverTooltip(third);

		expect(first).toHaveBeenCalledOnce();
		expect(second).toHaveBeenCalledOnce();
		expect(third).not.toHaveBeenCalled();
		releaseHoverTooltip(third);
	});

	it('dismisses and releases the active tooltip before persistent context navigation', () => {
		const current = vi.fn();
		const next = vi.fn();

		claimHoverTooltip(current);
		dismissActiveHoverTooltip();
		claimHoverTooltip(next);

		expect(current).toHaveBeenCalledOnce();
		expect(next).not.toHaveBeenCalled();
		releaseHoverTooltip(next);
	});
});
