import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTOMATION_BOUNDARY } from '$contract/automations';
import { agentBoundary, type BoundaryPlaces } from './boundary';

const PLACES: BoundaryPlaces = {
	appDataRoot: '/data/malini',
	checkoutsRoot: '/data/malini',
	appDataEntries: ['malini.sqlite', 'malini.sqlite-wal', 'workstreams', 'repositories', 'logs'],
	checkouts: [{ path: '/data/malini/workstreams/ws-1' }, { path: '/data/malini/workstreams/ws-2' }],
};

describe("an automation's boundary", () => {
	it('hides every chat record and attachment from an automation that sees no chat', () => {
		const boundary = agentBoundary({ ...DEFAULT_AUTOMATION_BOUNDARY, chats: 'starter' }, PLACES);

		expect(boundary).toEqual({
			hidden: [
				'/data/malini/workstreams/ws-1/.malini/agent-attachments',
				'/data/malini/workstreams/ws-2/.malini/agent-attachments',
				'/data/malini/malini.sqlite',
				'/data/malini/malini.sqlite-wal',
				'/data/malini/logs',
				'/data/malini/workstreams/.kept',
				'/data/malini/workstreams/.trash',
			],
			chatRecords: false,
			internet: true,
		});
	});

	it('hides nothing from an automation you let see everything', () => {
		const everything = { ...DEFAULT_AUTOMATION_BOUNDARY, chats: 'all', attachments: true } as const;

		expect(agentBoundary(everything, PLACES)).toBeNull();
		expect(agentBoundary({ ...everything, internet: false }, PLACES)).toEqual({
			hidden: [],
			chatRecords: true,
			internet: false,
		});
	});

	it('hides archived workstreams until an automation sees every chat and attachment', () => {
		const everything = { ...DEFAULT_AUTOMATION_BOUNDARY, chats: 'all', attachments: true } as const;
		const archived = ['/data/malini/workstreams/.kept', '/data/malini/workstreams/.trash'];

		expect(agentBoundary({ ...everything, attachments: false }, PLACES)?.hidden).toEqual([
			'/data/malini/workstreams/ws-1/.malini/agent-attachments',
			'/data/malini/workstreams/ws-2/.malini/agent-attachments',
			...archived,
		]);
		expect(agentBoundary({ ...everything, chats: 'starter' }, PLACES)?.hidden).toEqual(
			expect.arrayContaining(archived),
		);
	});
});
