import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculatePosition, layoutRect } from './positioning';

function rect(left: number, top: number, width: number, height: number): DOMRect {
	return {
		x: left,
		y: top,
		left,
		top,
		width,
		height,
		right: left + width,
		bottom: top + height,
		toJSON: () => ({}),
	};
}

afterEach(() => vi.unstubAllGlobals());

describe('Dropdown positioning', () => {
	it('keeps a top-side surface exactly above its trigger with the requested gap', () => {
		vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 900 });
		const trigger = rect(100, 500, 120, 28);
		const surface = rect(0, 0, 320, 300);

		const position = calculatePosition(trigger, surface, {
			side: 'top',
			align: 'start',
			sideOffset: 8,
		});

		expect(position.actualSide).toBe('top');
		expect(position.left).toBe(trigger.left);
		expect(position.top + surface.height).toBe(trigger.top - 8);
	});

	it('keeps the final top gap when the opening transition scales the visual rect', () => {
		vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 900 });
		const trigger = rect(100, 500, 120, 28);
		const layoutSurface = rect(0, 0, 320, 300);
		const transformedVisualSurface = rect(0, 0, 304, 285);

		const position = calculatePosition(trigger, layoutSurface, {
			side: 'top',
			align: 'start',
			sideOffset: 4,
		});

		expect(transformedVisualSurface.height).not.toBe(layoutSurface.height);
		expect(position.top + layoutSurface.height).toBe(trigger.top - 4);
	});

	it('measures a surface by its layout box, not by the scale of its opening transition', () => {
		const surface = { offsetWidth: 736, offsetHeight: 448 };
		expect(layoutRect(surface)).toMatchObject({ width: 736, height: 448, right: 736, bottom: 448 });
	});

	it('keeps a right-side surface inside the viewport when it is wider than the room beside its trigger', () => {
		vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800 });
		const trigger = rect(540, 600, 300, 20);
		const surface = rect(0, 0, 736, 448);

		const position = calculatePosition(trigger, surface, {
			side: 'right',
			align: 'start',
			sideOffset: 8,
			viewportPadding: 8,
		});

		expect(position.left + surface.width).toBeLessThanOrEqual(1280 - 8);
	});

	it('flips below rather than allowing a top surface to overlap its trigger', () => {
		vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 900 });
		const trigger = rect(100, 100, 120, 28);
		const surface = rect(0, 0, 320, 300);

		const position = calculatePosition(trigger, surface, {
			side: 'top',
			align: 'start',
			sideOffset: 8,
		});

		expect(position.actualSide).toBe('bottom');
		expect(position.top).toBe(trigger.bottom + 8);
	});
});
