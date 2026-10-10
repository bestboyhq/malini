import { describe, expect, it } from 'vitest';
import { cubicBezier } from './overlay-transition';

describe('cubicBezier', () => {
	it('matches the CSS curve it names', () => {
		const standard = cubicBezier(0.4, 0, 0.2, 1);
		expect(standard(0)).toBeCloseTo(0, 5);
		expect(standard(1)).toBeCloseTo(1, 5);
		expect(standard(0.5)).toBeCloseTo(0.7755, 3);
		expect(cubicBezier(0, 0, 1, 1)(0.3)).toBeCloseTo(0.3, 5);
	});
});
