import { describe, expect, it } from 'vitest';
import {
	arranged,
	DEFAULT_SIDEBAR_ARRANGEMENT,
	readSidebarArrangement,
	showsAttentionOnly,
} from './sidebar-arrangement';

describe('arranged', () => {
	it('groups by status when it shows only what needs you', () => {
		const next = arranged(DEFAULT_SIDEBAR_ARRANGEMENT, { show: 'attention' });
		expect(next.grouping).toBe('status');
		expect(showsAttentionOnly(next)).toBe(true);
	});

	it('shows everything again when the grouping leaves status', () => {
		const attention = arranged(DEFAULT_SIDEBAR_ARRANGEMENT, { show: 'attention' });
		const next = arranged(attention, { grouping: 'repository' });
		expect(next.show).toBe('everything');
		expect(showsAttentionOnly(next)).toBe(false);
	});

	it('keeps the filter when only the sub-grouping changes', () => {
		const attention = arranged(DEFAULT_SIDEBAR_ARRANGEMENT, { show: 'attention' });
		expect(arranged(attention, { subgrouping: 'none' }).show).toBe('attention');
	});
});

describe('readSidebarArrangement', () => {
	it('reads an arrangement saved before the filter existed as showing everything', () => {
		const saved = { grouping: 'status', subgrouping: 'none', ordering: 'manual' };
		expect(readSidebarArrangement(saved)).toEqual({ ...saved, show: 'everything' });
	});
});
