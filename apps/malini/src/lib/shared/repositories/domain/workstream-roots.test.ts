import { describe, expect, it } from 'vitest';
import { workstreamRoots } from './workstream-roots';

describe('workstream roots', () => {
	it('roots every workstream at the top-most open workstream above it', () => {
		const roots = workstreamRoots([
			{ id: 'top', startedBy: null },
			{ id: 'child', startedBy: 'top' },
			{ id: 'grandchild', startedBy: 'child' },
			{ id: 'orphan', startedBy: 'archived' },
			{ id: 'loop-a', startedBy: 'loop-b' },
			{ id: 'loop-b', startedBy: 'loop-a' },
		]);
		expect(Object.fromEntries(roots)).toEqual({
			top: 'top',
			child: 'top',
			grandchild: 'top',
			orphan: 'orphan',
			'loop-a': 'loop-b',
			'loop-b': 'loop-a',
		});
	});
});
