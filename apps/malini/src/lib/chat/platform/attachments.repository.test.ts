import { describe, expect, it } from 'vitest';
import {
	attachmentIdIsSafe,
	collectExpiredAttachments,
	deleteCollectedAttachment,
	insertRunAndBindAttachments,
	insertStagedAttachments,
	loadStoredAttachment,
	releaseRunAttachmentsForRetry,
	removeStagedAttachment,
	stagedAttachmentExpiryFrom,
	type StagedAgentAttachment,
} from './attachments.repository';
import { openMigratedDatabase } from '$main/db/open';
import { run, scalar } from '$main/db/rows';
import { getRun, type AgentRun } from './runs.repository';
import { insertSession } from './sessions.repository';
import { seedWorkstream } from '$main/db/test-fixtures';

const ID_A = 'att-00000000000000000000000000000001';
const ID_B = 'att-00000000000000000000000000000002';

function staged(id: string, size = 10): StagedAgentAttachment {
	return {
		id,
		displayName: 'a.txt',
		relativePath: `.malini/agent-attachments/${id}/a.txt`,
		mediaType: 'text/plain',
		size,
		sha256: '0'.repeat(64),
	};
}

function runFor(id: string): AgentRun {
	return {
		id,
		sessionId: 'session-att',
		prompt: 'send',
		startedAt: '2026-07-11T01:00:00.000Z',
		completedAt: null,
		summary: null,
		error: null,
	};
}

describe('attachments', () => {
	it('validates ids and computes the staged expiry', () => {
		expect(attachmentIdIsSafe(ID_A)).toBe(true);
		expect(attachmentIdIsSafe('att-short')).toBe(false);
		expect(attachmentIdIsSafe('xyz-00000000000000000000000000000001')).toBe(false);
		expect(stagedAttachmentExpiryFrom(new Date('2026-07-11T00:00:00.000Z'))).toBe(
			'2026-07-12T00:00:00.000Z',
		);
	});

	it('stages, binds to a run atomically, and releases for retry', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, 'workstream-att');
		insertSession(db, {
			id: 'session-att',
			workstreamId: 'workstream-att',
			model: null,
			providerSessionId: null,
			status: 'idle',
			startedAt: '2026-07-11T00:00:00.000Z',
		});
		expect(() =>
			insertStagedAttachments(
				db,
				'workstream-missing',
				[staged(ID_A)],
				'2026-07-11T00:00:00.000Z',
				'2026-07-12T00:00:00.000Z',
			),
		).toThrow('workstream `workstream-missing` is missing or inactive');
		insertStagedAttachments(
			db,
			'workstream-att',
			[staged(ID_A), staged(ID_B)],
			'2026-07-11T00:00:00.000Z',
			'2026-07-12T00:00:00.000Z',
		);
		expect(loadStoredAttachment(db, ID_A)).toEqual({
			descriptor: staged(ID_A),
			workstreamId: 'workstream-att',
			state: 'staged',
			runId: null,
			expiresAt: '2026-07-12T00:00:00.000Z',
		});

		const now = '2026-07-11T01:00:00.000Z';
		expect(() =>
			insertRunAndBindAttachments(db, {
				workstreamId: 'workstream-att',
				run: runFor('run-dup'),
				attachmentIds: [ID_A, ID_A],
				now,
			}),
		).toThrow('attachment ids must be unique staged attachment identifiers');
		expect(() =>
			insertRunAndBindAttachments(db, {
				workstreamId: 'workstream-att',
				run: runFor('run-unknown'),
				attachmentIds: ['att-ffffffffffffffffffffffffffffffff'],
				now,
			}),
		).toThrow('attachment `att-ffffffffffffffffffffffffffffffff` is not staged');
		expect(() =>
			insertRunAndBindAttachments(db, {
				workstreamId: 'workstream-other',
				run: runFor('run-foreign'),
				attachmentIds: [ID_A],
				now,
			}),
		).toThrow(
			`attachment \`${ID_A}\` is expired, already consumed, or belongs to another workstream`,
		);
		expect(() =>
			insertRunAndBindAttachments(db, {
				workstreamId: 'workstream-att',
				run: runFor('run-verify'),
				attachmentIds: [ID_A],
				now,
				verify: () => {
					throw new Error('file changed since staging');
				},
			}),
		).toThrow('file changed since staging');
		expect(getRun(db, 'run-verify')).toBeNull();
		expect(loadStoredAttachment(db, ID_A)?.state).toBe('staged');

		const seen: string[] = [];
		const bound = insertRunAndBindAttachments(db, {
			workstreamId: 'workstream-att',
			run: runFor('run-bound'),
			attachmentIds: [ID_A, ID_B],
			now,
			verify: (stored) => {
				seen.push(stored.descriptor.id);
			},
		});
		expect(seen).toEqual([ID_A, ID_B]);
		expect(bound).toEqual([staged(ID_A), staged(ID_B)]);
		expect(getRun(db, 'run-bound')).not.toBeNull();
		expect(loadStoredAttachment(db, ID_A)).toMatchObject({
			state: 'bound',
			runId: 'run-bound',
			expiresAt: null,
		});
		expect(() =>
			insertRunAndBindAttachments(db, {
				workstreamId: 'workstream-att',
				run: runFor('run-again'),
				attachmentIds: [ID_A],
				now,
			}),
		).toThrow('already consumed');

		expect(releaseRunAttachmentsForRetry(db, 'run-bound', '2026-07-13T00:00:00.000Z')).toBe(2);
		expect(loadStoredAttachment(db, ID_B)).toMatchObject({
			state: 'staged',
			runId: null,
			expiresAt: '2026-07-13T00:00:00.000Z',
		});

		expect(
			insertRunAndBindAttachments(db, {
				workstreamId: 'workstream-att',
				run: runFor('run-plain'),
				attachmentIds: [],
				now,
			}),
		).toEqual([]);
		expect(getRun(db, 'run-plain')).not.toBeNull();
		db.close();
	});

	it('removes staged rows and collects expired and orphaned ones', () => {
		const db = openMigratedDatabase(':memory:');
		seedWorkstream(db, 'workstream-gc');
		insertSession(db, {
			id: 'session-att',
			workstreamId: 'workstream-gc',
			model: null,
			providerSessionId: null,
			status: 'idle',
			startedAt: '2026-07-11T00:00:00.000Z',
		});
		insertStagedAttachments(
			db,
			'workstream-gc',
			[staged(ID_A), staged(ID_B)],
			'2026-07-11T00:00:00.000Z',
			'2026-07-12T00:00:00.000Z',
		);
		expect(() => removeStagedAttachment(db, 'workstream-gc', 'bad', 'now')).toThrow(
			'attachment id is unsafe',
		);
		expect(() => removeStagedAttachment(db, 'workstream-other', ID_A, 'now')).toThrow(
			`staged attachment \`${ID_A}\` not found`,
		);
		removeStagedAttachment(db, 'workstream-gc', ID_A, '2026-07-11T02:00:00.000Z');
		expect(() => removeStagedAttachment(db, 'workstream-gc', ID_A, 'now')).toThrow(
			`attachment \`${ID_A}\` cannot be removed from state \`removed\``,
		);

		insertRunAndBindAttachments(db, {
			workstreamId: 'workstream-gc',
			run: runFor('run-orphan'),
			attachmentIds: [ID_B],
			now: '2026-07-11T01:00:00.000Z',
		});
		run(db, "DELETE FROM agent_runs WHERE id = 'run-orphan'");
		expect(
			collectExpiredAttachments(db, 'workstream-gc', '2026-07-11T03:00:00.000Z').sort(),
		).toEqual([ID_A, ID_B]);
		expect(loadStoredAttachment(db, ID_B)).toMatchObject({ state: 'expired', runId: null });
		expect(deleteCollectedAttachment(db, ID_A, 'workstream-gc')).toBe(1);
		expect(deleteCollectedAttachment(db, ID_A, 'workstream-gc')).toBe(0);
		expect(deleteCollectedAttachment(db, ID_B, 'workstream-gc')).toBe(1);
		expect(scalar(db, 'SELECT COUNT(*) FROM agent_attachments')).toBe(0);
		db.close();
	});
});
