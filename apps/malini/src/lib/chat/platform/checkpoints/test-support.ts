import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { run } from '$main/db/rows';
import { insertRun } from '../runs.repository';
import { insertSession } from '../sessions.repository';
import {
	createCheckoutResolver,
	upsertProject,
	upsertWorkstream,
	type CheckoutResolver,
} from '$shared/repositories/repositories.platform';
import type { EventBus } from '$main/events';
import { realGit } from '$main/git/fixtures.test-support';
import { IdSequence } from '../id-sequence';
import { SnapshotRefNamespace } from '../snapshot-refs';
import type { CheckpointContext } from './service';

export const WORKSTREAM_ID = 'workstream-run-changes';
export const PROJECT_ID = 'project-run-changes';

export { realGit } from '$main/git/fixtures.test-support';

export async function initSeededRepo(repo: string): Promise<void> {
	await mkdir(repo, { recursive: true });
	await realGit(repo, ['init', '-q']);
	await realGit(repo, ['config', 'user.name', 'Checkpoint Test']);
	await realGit(repo, ['config', 'user.email', 'checkpoint@example.com']);
	await writeFile(join(repo, 'tracked.txt'), 'base\n');
	await realGit(repo, ['add', 'tracked.txt']);
	await realGit(repo, ['commit', '-q', '-m', 'base']);
}

export async function seededWorkstream(appDataRoot: string): Promise<string> {
	const repo = join(appDataRoot, 'workstreams', WORKSTREAM_ID);
	await initSeededRepo(repo);
	return repo;
}

export function databaseResolver(db: MaliniDatabase, appDataRoot: string): CheckoutResolver {
	return createCheckoutResolver({ db, appDataRoot });
}

export function seedRunChangeDb(db: MaliniDatabase, repo: string): void {
	upsertProject(db, {
		id: PROJECT_ID,
		name: 'Run changes',
		repoPath: repo,
		defaultBranch: 'main',
		createdAt: '2026-07-22T00:00:00.000Z',
	});
	upsertWorkstream(db, {
		id: WORKSTREAM_ID,
		projectId: PROJECT_ID,
		name: 'Run changes',
		path: repo,
		branch: 'codex/run-changes',
		baseBranch: 'main',
		status: 'active',
		createdAt: '2026-07-22T00:00:00.000Z',
	});
	for (const sessionId of ['chat-a', 'chat-b']) {
		insertSession(db, {
			id: sessionId,
			workstreamId: WORKSTREAM_ID,
			model: null,
			providerSessionId: null,
			status: 'running',
			startedAt: '2026-07-22T00:00:00.000Z',
		});
	}
}

export function insertOpenRun(
	db: MaliniDatabase,
	sessionId: string,
	runId: string,
	startedAt: string,
): void {
	insertRun(db, {
		id: runId,
		sessionId,
		prompt: `prompt for ${sessionId}`,
		startedAt,
		completedAt: null,
		summary: null,
		error: null,
	});
}

export function markRunCompleted(db: MaliniDatabase, runId: string): void {
	run(db, "UPDATE agent_runs SET completed_at = '2026-07-22T00:10:00.000Z' WHERE id = ?", runId);
}

export interface CheckpointHarness {
	readonly db: MaliniDatabase;
	readonly repo: string;
	readonly context: CheckpointContext;
}

export async function checkpointHarness(appDataRoot: string): Promise<CheckpointHarness> {
	const repo = await seededWorkstream(appDataRoot);
	const db = openMigratedDatabase(':memory:');
	seedRunChangeDb(db, repo);
	return {
		db,
		repo,
		context: {
			db,
			appDataRoot,
			resolver: databaseResolver(db, appDataRoot),
			ids: new IdSequence(),
			snapshotRefs: new SnapshotRefNamespace(),
		},
	};
}

export interface RecordedFrame {
	channel: string;
	payload: unknown;
}

type AnyPayloadListener = { bivarianceHack(payload: unknown): void }['bivarianceHack'];

export function recordingBus(): EventBus & { frames: RecordedFrame[] } {
	const frames: RecordedFrame[] = [];
	const listeners = new Map<string, Set<AnyPayloadListener>>();
	return {
		frames,
		emit(channel, payload) {
			frames.push({ channel, payload });
			for (const listener of listeners.get(channel) ?? []) listener(payload);
		},
		subscribe(channel, listener) {
			let set = listeners.get(channel);
			if (!set) {
				set = new Set();
				listeners.set(channel, set);
			}
			set.add(listener);
			return () => {
				set.delete(listener);
			};
		},
	};
}

export async function refExists(repo: string, ref: string): Promise<boolean> {
	try {
		await realGit(repo, ['show-ref', '--verify', ref]);
		return true;
	} catch {
		return false;
	}
}

export async function listRefs(repo: string, namespace: string): Promise<string[]> {
	const output = await realGit(repo, ['for-each-ref', '--format=%(refname)', namespace]);
	return output.split('\n').filter((line) => line.length > 0);
}

export async function treeFiles(repo: string, commit: string): Promise<string[]> {
	const output = await realGit(repo, ['ls-tree', '-r', '--name-only', commit]);
	return output.split('\n').filter((line) => line.length > 0);
}
