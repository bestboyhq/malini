import { describe, expect, it } from 'vitest';
import { workstreamLeads } from './workstream-leads';

describe('workstream leads', () => {
	it('leads every workstream from the top-most open workstream above it', () => {
		const leads = workstreamLeads([
			{ id: 'home', startedBy: null },
			{ id: 'child', startedBy: 'home' },
			{ id: 'grandchild', startedBy: 'child' },
			{ id: 'orphan', startedBy: 'archived' },
			{ id: 'loop-a', startedBy: 'loop-b' },
			{ id: 'loop-b', startedBy: 'loop-a' },
		]);
		expect(Object.fromEntries(leads)).toEqual({
			home: 'home',
			child: 'home',
			grandchild: 'home',
			orphan: 'orphan',
			'loop-a': 'loop-b',
			'loop-b': 'loop-a',
		});
	});
});
