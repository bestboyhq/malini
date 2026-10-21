import { describe, expect, it } from 'vitest';
import { ARCHIVED_HEIGHT, archivedOverflows } from './sidebar-archived';

describe('archivedOverflows', () => {
	it('offers more only when the rows do not fit the height', () => {
		expect(archivedOverflows(4, ARCHIVED_HEIGHT.initial)).toBe(false);
		expect(archivedOverflows(5, ARCHIVED_HEIGHT.initial)).toBe(true);
		expect(archivedOverflows(2, ARCHIVED_HEIGHT.min)).toBe(false);
		expect(archivedOverflows(3, ARCHIVED_HEIGHT.min)).toBe(true);
		expect(archivedOverflows(0, ARCHIVED_HEIGHT.min)).toBe(false);
	});
});
