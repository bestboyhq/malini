import { describe, expect, it } from 'vitest';
import { ARCHIVED_HEIGHT, archivedOverflows } from './sidebar-archived';

describe('archivedOverflows', () => {
	it('offers more only when the rows and their fade do not fit the height', () => {
		expect(archivedOverflows(3, ARCHIVED_HEIGHT.initial)).toBe(false);
		expect(archivedOverflows(4, ARCHIVED_HEIGHT.initial)).toBe(true);
		expect(archivedOverflows(1, ARCHIVED_HEIGHT.min)).toBe(false);
		expect(archivedOverflows(0, ARCHIVED_HEIGHT.min)).toBe(false);
	});
});
