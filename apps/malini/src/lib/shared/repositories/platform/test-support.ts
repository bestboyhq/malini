import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { run } from '$main/db/rows';
import { createEventBus, type EventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';

export function seedWorkstream(
	db: MaliniDatabase,
	workstreamId: string,
	path: string,
	status = 'active',
): void {
	const now = new Date().toISOString();
	const projectId = `proj-${workstreamId}`;
	run(
		db,
		'INSERT OR IGNORE INTO projects (id, name, repo_path, default_branch, created_at) VALUES (?, ?, ?, ?, ?)',
		projectId,
		workstreamId,
		'/tmp/test-repo',
		'main',
		now,
	);
	run(
		db,
		'INSERT INTO workstreams (id, project_id, name, path, branch, base_branch, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
		workstreamId,
		projectId,
		workstreamId,
		path,
		`malini/${workstreamId}`,
		'main',
		status,
		now,
	);
}

export function recordingEventBus(): EventBus & {
	readonly frames: Array<{ channel: string; payload: unknown }>;
} {
	const bus = createEventBus({ forwardToWindows: false });
	const frames: Array<{ channel: string; payload: unknown }> = [];
	return {
		frames,
		emit(channel, payload) {
			frames.push({ channel, payload });
			bus.emit(channel, payload);
		},
		subscribe: (channel, listener) => bus.subscribe(channel, listener),
	};
}

export interface TestContext {
	readonly context: MainContext;
	readonly events: ReturnType<typeof recordingEventBus>;
	readonly appDataRoot: string;
	cleanup(): void;
}

export function createTestContext(): TestContext {
	const appDataRoot = mkdtempSync(join(tmpdir(), 'malini-environment-'));
	const db = openMigratedDatabase(':memory:');
	const events = recordingEventBus();
	const context: MainContext = {
		db,
		commands: new CommandRegistry(),
		events,
		appDataRoot,
		resourcesRoot: appDataRoot,
		isDev: true,
		appVersion: '0.0.0-test',
	};
	return {
		context,
		events,
		appDataRoot,
		cleanup() {
			db.close();
			rmSync(appDataRoot, { recursive: true, force: true });
		},
	};
}
