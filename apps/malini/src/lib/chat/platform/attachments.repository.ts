import type { MaliniDatabase } from '$main/db/driver';
import { insertRun, insertRunForWorkstream, type AgentRun } from './runs.repository';
import { column, get, run } from '$main/db/rows';
import type { StagedAgentAttachment } from '$contract/agent';

export type { StagedAgentAttachment };

export const MAX_ATTACHMENT_FILES = 10;
export const MAX_ATTACHMENT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;
export const STAGED_ATTACHMENT_TTL_HOURS = 24;

export type AttachmentState = 'staged' | 'bound' | 'removed' | 'expired';

export interface StoredAttachment {
	descriptor: StagedAgentAttachment;
	workstreamId: string;
	state: AttachmentState;
	runId: string | null;
	expiresAt: string | null;
}

interface AttachmentRow {
	id: string;
	workstream_id: string;
	run_id: string | null;
	display_name: string;
	relative_path: string;
	media_type: string;
	size: number;
	sha256: string;
	state: AttachmentState;
	expires_at: string | null;
}

export function attachmentIdIsSafe(id: string): boolean {
	return /^att-[0-9a-fA-F]{32}$/.test(id);
}

export function stagedAttachmentExpiryFrom(now: Date = new Date()): string {
	return new Date(now.getTime() + STAGED_ATTACHMENT_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

export function insertStagedAttachments(
	db: MaliniDatabase,
	workstreamId: string,
	attachments: readonly StagedAgentAttachment[],
	createdAt: string,
	expiresAt: string,
): void {
	db.transaction(() => {
		for (const attachment of attachments) {
			const { changes } = run(
				db,
				`INSERT INTO agent_attachments
				 (id, workstream_id, run_id, display_name, relative_path, media_type, size, sha256,
				  state, created_at, expires_at, bound_at, removed_at)
				 SELECT ?, ?, NULL, ?, ?, ?, ?, ?, 'staged', ?, ?, NULL, NULL
				 WHERE EXISTS (SELECT 1 FROM workstreams WHERE id = ? AND status = 'active')`,
				attachment.id,
				workstreamId,
				attachment.displayName,
				attachment.relativePath,
				attachment.mediaType,
				attachment.size,
				attachment.sha256,
				createdAt,
				expiresAt,
				workstreamId,
			);
			if (changes !== 1) throw new Error(`workstream \`${workstreamId}\` is missing or inactive`);
		}
	});
}

export function loadStoredAttachment(db: MaliniDatabase, id: string): StoredAttachment | null {
	const row = get<AttachmentRow>(
		db,
		`SELECT id, workstream_id, run_id, display_name, relative_path, media_type, size, sha256,
		        state, expires_at
		 FROM agent_attachments WHERE id = ?`,
		id,
	);
	if (!row) return null;
	return {
		descriptor: {
			id: row.id,
			displayName: row.display_name,
			relativePath: row.relative_path,
			mediaType: row.media_type,
			size: row.size,
			sha256: row.sha256,
		},
		workstreamId: row.workstream_id,
		state: row.state,
		runId: row.run_id,
		expiresAt: row.expires_at,
	};
}

export interface InsertRunAndBindAttachmentsInput {
	workstreamId: string;
	run: AgentRun;
	attachmentIds: readonly string[];
	now: string;
	verify?: (stored: StoredAttachment) => void;
}

export function insertRunAndBindAttachments(
	db: MaliniDatabase,
	input: InsertRunAndBindAttachmentsInput,
): StagedAgentAttachment[] {
	const { workstreamId, run: agentRun, attachmentIds, now } = input;
	if (attachmentIds.length === 0) {
		insertRun(db, agentRun);
		return [];
	}
	if (attachmentIds.length > MAX_ATTACHMENT_FILES) {
		throw new Error(`at most ${MAX_ATTACHMENT_FILES} staged attachments can be sent`);
	}
	const unique = new Set<string>();
	for (const id of attachmentIds) {
		if (!attachmentIdIsSafe(id) || unique.has(id)) {
			throw new Error('attachment ids must be unique staged attachment identifiers');
		}
		unique.add(id);
	}

	return db.transaction(() => {
		const verified: StagedAgentAttachment[] = [];
		let totalSize = 0;
		for (const id of attachmentIds) {
			const stored = loadStoredAttachment(db, id);
			if (!stored) throw new Error(`attachment \`${id}\` is not staged`);
			const validOwnerAndState =
				stored.workstreamId === workstreamId &&
				stored.state === 'staged' &&
				stored.expiresAt !== null &&
				stored.expiresAt > now;
			if (!validOwnerAndState) {
				throw new Error(
					`attachment \`${id}\` is expired, already consumed, or belongs to another workstream`,
				);
			}
			input.verify?.(stored);
			totalSize += stored.descriptor.size;
			if (!Number.isSafeInteger(totalSize)) throw new Error('attachment size overflow');
			if (totalSize > MAX_ATTACHMENT_TOTAL_BYTES) {
				throw new Error(`attachments exceed the ${MAX_ATTACHMENT_TOTAL_BYTES}-byte total limit`);
			}
			verified.push(stored.descriptor);
		}

		insertRunForWorkstream(db, agentRun, workstreamId);

		for (const attachment of verified) {
			const { changes } = run(
				db,
				`UPDATE agent_attachments
				 SET state = 'bound', run_id = ?, bound_at = ?, expires_at = NULL
				 WHERE id = ? AND workstream_id = ? AND state = 'staged' AND expires_at > ?`,
				agentRun.id,
				now,
				attachment.id,
				workstreamId,
				now,
			);
			if (changes !== 1) {
				throw new Error(`attachment \`${attachment.id}\` changed while the run was being created`);
			}
		}
		return verified;
	});
}

export function releaseRunAttachmentsForRetry(
	db: MaliniDatabase,
	runId: string,
	expiresAt: string,
): number {
	return run(
		db,
		`UPDATE agent_attachments
		 SET state = 'staged', run_id = NULL, bound_at = NULL, expires_at = ?, removed_at = NULL
		 WHERE run_id = ? AND state = 'bound'`,
		expiresAt,
		runId,
	).changes;
}

export function removeStagedAttachment(
	db: MaliniDatabase,
	workstreamId: string,
	attachmentId: string,
	removedAt: string,
): void {
	if (!attachmentIdIsSafe(attachmentId)) throw new Error('attachment id is unsafe');
	db.transaction(() => {
		const row = get<{ state: AttachmentState }>(
			db,
			'SELECT state FROM agent_attachments WHERE id = ? AND workstream_id = ?',
			attachmentId,
			workstreamId,
		);
		if (!row) throw new Error(`staged attachment \`${attachmentId}\` not found`);
		if (row.state !== 'staged') {
			throw new Error(
				`attachment \`${attachmentId}\` cannot be removed from state \`${row.state}\``,
			);
		}
		run(
			db,
			`UPDATE agent_attachments
			 SET state = 'removed', expires_at = ?, removed_at = ?
			 WHERE id = ? AND workstream_id = ? AND state = 'staged'`,
			removedAt,
			removedAt,
			attachmentId,
			workstreamId,
		);
	});
}

export function collectExpiredAttachments(
	db: MaliniDatabase,
	workstreamId: string,
	now: string,
): string[] {
	return db.transaction(() => {
		run(
			db,
			`UPDATE agent_attachments
			 SET state = 'expired'
			 WHERE workstream_id = ? AND state = 'staged' AND expires_at <= ?`,
			workstreamId,
			now,
		);
		run(
			db,
			`UPDATE agent_attachments
			 SET state = 'expired', run_id = NULL, bound_at = NULL, expires_at = ?
			 WHERE workstream_id = ? AND state = 'bound'
			   AND NOT EXISTS (
			     SELECT 1 FROM agent_runs WHERE agent_runs.id = agent_attachments.run_id
			   )`,
			now,
			workstreamId,
		);
		return column(
			db,
			`SELECT id FROM agent_attachments
			 WHERE workstream_id = ? AND state IN ('removed','expired')`,
			workstreamId,
		);
	});
}

export function deleteCollectedAttachment(
	db: MaliniDatabase,
	attachmentId: string,
	workstreamId: string,
): number {
	return run(
		db,
		`DELETE FROM agent_attachments
		 WHERE id = ? AND workstream_id = ? AND state IN ('removed','expired')`,
		attachmentId,
		workstreamId,
	).changes;
}
