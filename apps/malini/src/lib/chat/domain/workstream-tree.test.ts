import { describe, expect, it } from 'vitest';
import { descendantWorkstreamIds } from './workstream-tree';

describe('descendantWorkstreamIds', () => {
	it('reaches every workstream started down the tree, and stops at a loop', () => {
		expect(
			descendantWorkstreamIds('root', [
				{ id: 'root', startedBy: 'grandchild' },
				{ id: 'child', startedBy: 'root' },
				{ id: 'grandchild', startedBy: 'child' },
				{ id: 'great-grandchild', startedBy: 'grandchild' },
				{ id: 'sibling', startedBy: null },
			]),
		).toEqual(new Set(['child', 'grandchild', 'great-grandchild']));
	});
});
