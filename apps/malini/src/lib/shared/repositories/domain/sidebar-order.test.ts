import { describe, expect, it } from 'vitest';
import {
	inSidebarOrder,
	movedInSidebarOrder,
	readSidebarOrder,
} from '$shared/repositories/domain/sidebar-order';

const items = (...ids: string[]): { id: string }[] => ids.map((id) => ({ id }));
const ids = (list: readonly { id: string }[]): string[] => list.map((item) => item.id);

describe('sidebar order', () => {
	it('lists unordered items first in their incoming order, then the saved order', () => {
		expect(ids(inSidebarOrder(items('new', 'a', 'b', 'c'), ['c', 'a', 'gone', 'b']))).toEqual([
			'new',
			'c',
			'a',
			'b',
		]);
	});

	it('moves an item before or after a target and keeps a self-drop or unknown id unchanged', () => {
		const listed = ['a', 'b', 'c', 'd'];
		expect(movedInSidebarOrder(listed, 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c']);
		expect(movedInSidebarOrder(listed, 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
		expect(movedInSidebarOrder(listed, 'b', 'b', 'after')).toEqual(listed);
		expect(movedInSidebarOrder(listed, 'x', 'b', 'after')).toEqual(listed);
		expect(movedInSidebarOrder(listed, 'a', 'x', 'after')).toEqual(listed);
	});

	it('reads only string ids from whatever storage holds', () => {
		expect(readSidebarOrder({ repositoryIds: ['r', 1], workstreamIds: 'w' })).toEqual({
			repositoryIds: ['r'],
			workstreamIds: [],
		});
		expect(readSidebarOrder(null)).toEqual({ repositoryIds: [], workstreamIds: [] });
	});
});
