import { describe, expect, it } from 'vitest';
import { fittingCount } from './running-groups';

describe('how many running items fit on the line under a workstream', () => {
	it('fits every item when they all fit, without room for a count', () => {
		expect(fittingCount([40, 40, 40, 40], 160, 30)).toBe(4);
	});

	it('fits what leaves room for the count of the rest', () => {
		expect(fittingCount([40, 40, 40, 40], 130, 30)).toBe(2);
	});

	it('fits none when even the first item and the count do not fit', () => {
		expect(fittingCount([120, 40], 130, 30)).toBe(0);
	});
});
