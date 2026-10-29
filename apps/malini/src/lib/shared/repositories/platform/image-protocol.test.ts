import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));

import { openMigratedDatabase } from '$main/db/open';
import { run } from '$main/db/rows';
import { createEventBus } from '$main/events';
import { workstreamMedia } from './image-protocol';
import {
	dropKeptFolders,
	keepFolders,
	keepShownFile,
	restoreKeptFolders,
	shownFile,
} from './kept-folders';
import { upsertProject } from './projects.repository';
import { upsertWorkstream } from './workstreams.repository';

const PNG = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const NOW = '2026-10-24T00:00:00.000Z';

let root: string;
let appDataRoot: string;

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), 'malini-shown-')));
	appDataRoot = join(root, 'app');
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function chatInWorktree() {
	const db = openMigratedDatabase(':memory:');
	const worktree = join(root, 'worktree');
	mkdirSync(join(worktree, '.context'), { recursive: true });
	upsertProject(db, {
		id: 'proj',
		name: 'proj',
		repoPath: join(root, 'repo'),
		defaultBranch: 'main',
		createdAt: NOW,
	});
	upsertWorkstream(db, {
		id: 'ws-1',
		projectId: 'proj',
		name: 'ws-1',
		path: worktree,
		branch: 'malini/ws-1',
		baseBranch: 'main',
		status: 'active',
		createdAt: NOW,
		scope: null,
		startedBy: null,
	});
	run(
		db,
		'INSERT INTO agent_sessions (id, workstream_id, status, started_at) VALUES (?, ?, ?, ?)',
		'sess-1',
		'ws-1',
		'running',
		NOW,
	);
	run(
		db,
		'INSERT INTO agent_runs (id, session_id, prompt, started_at) VALUES (?, ?, ?, ?)',
		'run-1',
		'sess-1',
		'show it',
		NOW,
	);
	const events = createEventBus({ forwardToWindows: false });
	const resolve = workstreamMedia(
		{ db, events, appDataRoot },
		{ resolveCheckout: () => Promise.resolve(worktree) },
	);
	const show = (event: Record<string, unknown>): void =>
		events.emit('chat:agent-event', {
			sessionId: 'sess-1',
			runId: 'run-1',
			seq: 1,
			event: { runId: 'run-1', ...event },
		});
	return { worktree, resolve, show };
}

describe('workstreamMedia', () => {
	it('serves the copy it kept of what a chat showed once the agent deletes the file', async () => {
		const { worktree, resolve, show } = chatInWorktree();
		const shot = join(worktree, '.context', 'shot.png');
		writeFileSync(shot, PNG);
		writeFileSync(join(worktree, '.context', 'read.png'), PNG);

		show({ type: 'assistant.message', text: '![Shot](.context/shot.png)' });
		show({
			type: 'tool.started',
			name: 'Read',
			input: { file_path: join(worktree, '.context', 'read.png') },
		});
		await vi.waitFor(async () => {
			expect(await shownFile(appDataRoot, 'ws-1', '.context/shot.png')).not.toBeNull();
			expect(await shownFile(appDataRoot, 'ws-1', '.context/read.png')).not.toBeNull();
		});

		writeFileSync(shot, Buffer.concat([PNG, Buffer.from('redrawn')]));
		expect(await resolve('ws-1', '.context/shot.png')).toBe(shot);

		rmSync(join(worktree, '.context'), { recursive: true });
		const kept = await resolve('ws-1', '.context/shot.png');
		expect(kept && readFileSync(kept)).toEqual(PNG);
		const read = await resolve('ws-1', '.context/read.png');
		expect(read && readFileSync(read)).toEqual(PNG);
		expect(await resolve('ws-1', '.context/never-shown.png')).toBeNull();
		await expect(resolve('ws-1', '../outside.png')).rejects.toThrow('escapes the workstream');
	});
});

describe('a lead', () => {
	it('shows what a workstream it started shows, by its absolute path', async () => {
		const db = openMigratedDatabase(':memory:');
		const lead = join(root, 'lead');
		const started = join(root, 'started');
		mkdirSync(join(started, '.context'), { recursive: true });
		mkdirSync(lead, { recursive: true });
		const shot = join(started, '.context', 'variant-a.png');
		writeFileSync(shot, PNG);
		writeFileSync(join(root, 'elsewhere.png'), PNG);
		upsertProject(db, {
			id: 'proj',
			name: 'proj',
			repoPath: join(root, 'repo'),
			defaultBranch: 'main',
			createdAt: NOW,
		});
		const workstream = (id: string, path: string, startedBy: string | null) =>
			upsertWorkstream(db, {
				id,
				projectId: 'proj',
				name: id,
				path,
				branch: `malini/${id}`,
				baseBranch: 'main',
				status: 'active',
				createdAt: NOW,
				scope: startedBy === null ? 'home' : null,
				startedBy,
			});
		workstream('ws-lead', lead, null);
		workstream('ws-started', started, 'ws-lead');
		run(
			db,
			'INSERT INTO agent_sessions (id, workstream_id, status, started_at) VALUES (?, ?, ?, ?)',
			'sess-lead',
			'ws-lead',
			'running',
			NOW,
		);
		run(
			db,
			'INSERT INTO agent_runs (id, session_id, prompt, started_at) VALUES (?, ?, ?, ?)',
			'run-lead',
			'sess-lead',
			'relay it',
			NOW,
		);
		const events = createEventBus({ forwardToWindows: false });
		const resolve = workstreamMedia(
			{ db, events, appDataRoot },
			{ resolveCheckout: (id) => Promise.resolve(id === 'ws-lead' ? lead : started) },
		);

		expect(await resolve('ws-lead', shot)).toBe(shot);
		await expect(resolve('ws-lead', join(root, 'elsewhere.png'))).rejects.toThrow(
			'escapes the workstream',
		);

		events.emit('chat:agent-event', {
			sessionId: 'sess-lead',
			runId: 'run-lead',
			seq: 1,
			event: { runId: 'run-lead', type: 'assistant.message', text: `![A](${shot})` },
		});
		await vi.waitFor(async () => {
			expect(await shownFile(appDataRoot, 'ws-started', '.context/variant-a.png')).not.toBeNull();
		});
		rmSync(join(started, '.context'), { recursive: true });
		const kept = await resolve('ws-lead', shot);
		expect(kept && readFileSync(kept)).toEqual(PNG);
	});
});

describe('a shown file', () => {
	it('is never a copied link, outlives a restore, and goes with its workstream', async () => {
		const checkout = join(root, 'checkout');
		const shot = join(checkout, '.context', 'shot.png');
		mkdirSync(join(checkout, '.context'), { recursive: true });
		writeFileSync(shot, PNG);
		writeFileSync(join(root, 'secret.txt'), 'secret\n');
		symlinkSync(join(root, 'secret.txt'), join(checkout, '.context', 'link.png'));

		await keepShownFile(appDataRoot, 'ws-1', '.context/shot.png', shot);
		await keepShownFile(
			appDataRoot,
			'ws-1',
			'.context/link.png',
			join(checkout, '.context', 'link.png'),
		);
		expect(await shownFile(appDataRoot, 'ws-1', '.context/link.png')).toBeNull();

		await keepFolders(appDataRoot, 'ws-1', checkout);
		expect(existsSync(shot)).toBe(false);
		await restoreKeptFolders(appDataRoot, 'ws-1', checkout);
		expect(readFileSync(shot)).toEqual(PNG);
		expect(await shownFile(appDataRoot, 'ws-1', '.context/shot.png')).not.toBeNull();

		await dropKeptFolders(appDataRoot, 'ws-1');
		expect(await shownFile(appDataRoot, 'ws-1', '.context/shot.png')).toBeNull();
	});
});
