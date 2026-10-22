import { describe, expect, it } from 'vitest';
import { imageChanges, type ImagePixels } from './image-changes';

const WIDTH = 400;
const HEIGHT = 200;

function canvas(paint: readonly { x: number; y: number; w: number; h: number }[]): ImagePixels {
	const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
	for (const box of paint) {
		for (let y = box.y; y < box.y + box.h; y += 1) {
			for (let x = box.x; x < box.x + box.w; x += 1)
				data.set([20, 20, 20, 255], (y * WIDTH + x) * 4);
		}
	}
	return { width: WIDTH, height: HEIGHT, data };
}

describe('image changes', () => {
	it('finds each changed area, merges the edges of a shifted box into one, and reads them in order', () => {
		const before = canvas([
			{ x: 40, y: 20, w: 20, h: 10 },
			{ x: 300, y: 120, w: 60, h: 30 },
		]);
		const after = canvas([
			{ x: 40, y: 20, w: 30, h: 10 },
			{ x: 300, y: 122, w: 60, h: 30 },
			{ x: 40, y: 150, w: 10, h: 10 },
		]);

		const changes = imageChanges(before, after);

		expect(changes?.areas).toHaveLength(3);
		const [top, right, low] = changes?.areas ?? [];
		expect(top?.y).toBeLessThan(0.2);
		expect(right?.x).toBeGreaterThan(0.6);
		expect(low?.y).toBeGreaterThan(right?.y ?? 1);
		expect(changes?.mask[(25 * WIDTH + 65) * 4]).toBe(236);
		expect(changes?.mask[(25 * WIDTH + 45) * 4]).toBe(0);
	});

	it('reports no areas for identical pictures and gives up on pictures of different sizes', () => {
		expect(imageChanges(canvas([]), canvas([]))?.areas).toEqual([]);
		expect(
			imageChanges(canvas([]), { width: 1, height: 1, data: new Uint8ClampedArray(4) }),
		).toBeNull();
	});
});
