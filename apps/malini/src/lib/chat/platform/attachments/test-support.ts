import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { upsertProject } from '$shared/repositories/repositories.platform';
import { insertSession } from '../sessions.repository';
import { upsertWorkstream } from '$shared/repositories/repositories.platform';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { workstreamPath } from '$main/git/paths';
import { persistStagedAttachments, stageSelectedPaths } from './service';
import type { StagedAgentAttachment } from '../attachments.repository';

export const WORKSTREAM_ID = 'workstream-attachments';
export const SESSION_ID = 'session-attachments';
export const STAGED_AT = '2026-07-11T00:00:00.000Z';
export const EXPIRES_TOMORROW = '2026-07-12T00:00:00.000Z';

export const PIXEL_PNG = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0x64, 0xf8, 0xcf, 0x50,
	0x0f, 0x00, 0x03, 0x86, 0x01, 0x80, 0x5a, 0x34, 0x7d, 0x6b, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
	0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

export interface AttachmentsTestContext {
	readonly context: MainContext;
	readonly db: MaliniDatabase;
	readonly appDataRoot: string;
	readonly scratch: string;
	checkout(workstreamId: string, options?: { git?: boolean }): string;
	seed(workstreamId?: string, sessionId?: string): string;
	cleanup(): void;
}

export function createAttachmentsTestContext(): AttachmentsTestContext {
	const appDataRoot = mkdtempSync(join(tmpdir(), 'malini-attachments-'));
	const scratch = join(appDataRoot, 'scratch');
	mkdirSync(scratch);
	const db = openMigratedDatabase(':memory:');
	const context: MainContext = {
		db,
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot,
		resourcesRoot: appDataRoot,
		isDev: true,
		appVersion: '0.0.0-test',
	};
	const checkout = (workstreamId: string, options: { git?: boolean } = {}): string => {
		const dir = workstreamPath(appDataRoot, workstreamId);
		mkdirSync(dir, { recursive: true });
		if (options.git) execFileSync('git', ['init', '-q', dir]);
		return dir;
	};
	return {
		context,
		db,
		appDataRoot,
		scratch,
		checkout,
		seed(workstreamId = WORKSTREAM_ID, sessionId = SESSION_ID) {
			const dir = checkout(workstreamId);
			upsertProject(db, {
				id: `project-${workstreamId}`,
				name: 'Attachments',
				repoPath: join(appDataRoot, 'repositories', workstreamId),
				defaultBranch: 'main',
				createdAt: STAGED_AT,
			});
			upsertWorkstream(db, {
				id: workstreamId,
				projectId: `project-${workstreamId}`,
				name: 'Attachments',
				path: dir,
				branch: `codex/${workstreamId}`,
				baseBranch: 'main',
				status: 'active',
				createdAt: STAGED_AT,
			});
			insertSession(db, {
				id: sessionId,
				workstreamId,
				model: 'anthropic/claude-sonnet-4-6',
				providerSessionId: null,
				status: 'idle',
				startedAt: STAGED_AT,
			});
			return dir;
		},
		cleanup() {
			db.close();
			rmSync(appDataRoot, { recursive: true, force: true });
		},
	};
}

export function scratchFile(
	test: AttachmentsTestContext,
	name: string,
	contents: Buffer | string,
): string {
	const path = join(test.scratch, name);
	writeFileSync(path, contents);
	return path;
}

export function stagedInDb(
	test: AttachmentsTestContext,
	worktree: string,
	contents: Buffer | string,
	expiresAt: string = EXPIRES_TOMORROW,
	workstreamId: string = WORKSTREAM_ID,
): StagedAgentAttachment {
	const source = scratchFile(test, 'notes.txt', contents);
	const [attachment] = stageSelectedPaths(worktree, [source]);
	if (!attachment) throw new Error('nothing staged');
	persistStagedAttachments(test.db, workstreamId, [attachment], STAGED_AT, expiresAt);
	return attachment;
}
