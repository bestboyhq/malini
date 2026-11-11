import { describe, expect, it } from 'vitest';
import type { ExplorerItem } from '../../domain/explorer';
import { itemNote } from './explorer-copy';

function turnFinished(status: string): ExplorerItem {
	return {
		kind: 'event',
		row: 'turn-finished',
		id: 'event-1',
		at: 0,
		end: null,
		chainId: 'chain',
		cause: null,
		workstreamId: 'ws-a',
		hops: [],
		event: {
			id: 1,
			channel: 'chat:turn-finished',
			payload: { status },
			workstreamId: 'ws-a',
			cause: null,
			chainId: 'chain',
			emittedAt: '2026-11-09T00:00:00.000Z',
		},
	};
}

describe('itemNote', () => {
	it('notes a finished turn the way it notes the turn itself', () => {
		expect(itemNote(turnFinished('interrupted'))).toBe('interrupted');
		expect(itemNote(turnFinished('cancelled'))).toBe('stopped');
		expect(itemNote(turnFinished('succeeded'))).toBeNull();
	});
});
