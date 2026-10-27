import { describe, expect, it } from 'vitest';
import { ORPHAN_INTERRUPTED_ERROR } from '$contract/agent-state-machine';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { run } from '$main/db/rows';
import { readPublishedStats } from './published-stats';

const NOW = new Date(2026, 9, 15, 10);
const PUBLIC = ['bestboyhq/malini', 'bestboyhq/grip'];

describe('readPublishedStats', () => {
	it('counts complete local days only, splits runs at midnight, weighs agents at once by time, and sends only names from the closed lists', async () => {
		const db = openMigratedDatabase(':memory:');
		seedGitHubRepository(db, 'bestboyhq/malini', 'ws-malini');
		seedGitHubRepository(db, 'bestboyhq/grip', 'ws-grip');
		seedGitHubRepository(db, 'someone/secret', 'ws-secret', at(14, 9));
		seedProject(db, 'local__nowhere');
		seedWorkstream(db, 'ws-local', 'local__nowhere');
		seedProject(db, 'malini-lead-space');
		seedWorkstream(db, 'ws-lead', 'malini-lead-space', { scope: 'home' });
		seedWorkstream(db, 'ws-merged', 'local__bestboyhq__malini', { mergedAt: at(12, 18) });
		seedWorkstream(db, 'ws-merged-today', 'local__bestboyhq__malini', { mergedAt: at(15, 9) });
		seedWorkstream(db, 'ws-new', 'local__bestboyhq__malini', { createdAt: at(15, 9, 30) });
		seedSession(db, 'local', 'ws-local', 'user', 'haiku');
		seedSession(db, 'chat', 'ws-malini', 'user', 'opus');
		seedSession(db, 'job', 'ws-malini', 'job', 'claude-sonnet-4-5');
		seedSession(db, 'grip', 'ws-grip', 'user', 'fable');
		seedSession(db, 'secret', 'ws-secret', 'user', null);
		seedSession(db, 'lead', 'ws-lead', 'user', 'opus');

		seedRun(db, 'r0', 'local', at(11, 8), at(11, 8, 10));
		seedRun(db, 'r1', 'chat', at(13, 10), at(13, 12));
		seedRun(db, 'r2', 'job', at(13, 11), at(13, 11, 30));
		seedRun(db, 'r6', 'grip', at(13, 15), at(13, 15, 5));
		seedRun(db, 'r3', 'secret', at(14, 23), at(15, 1));
		seedRun(db, 'r4', 'lead', at(14, 22, 30), at(16, 9), ORPHAN_INTERRUPTED_ERROR);
		seedRun(db, 'r5', 'chat', at(15, 9), at(15, 9, 30));

		seedToolCalls(db, 'chat', 'r1', at(13, 10, 5), [
			'Bash',
			'Bash',
			'Bash',
			'mcp__malini__browser_screenshot',
			'mcp__malini__browser_screenshot',
			'mcp__malini__jobs_run',
			'mcp__plugin_private_server__secret_tool',
			'Skill',
			'Compact',
		]);
		seedToolCalls(db, 'job', 'r2', at(13, 11, 5), ['Read', 'Read']);
		seedToolCalls(db, 'secret', 'r3', at(14, 23, 5), ['Bash', 'Bash', 'Bash', 'Bash', 'Bash']);
		seedToolCalls(db, 'lead', 'r4', at(14, 23, 20), ['Edit']);
		seedEvent(db, 'lead', 'r4', 'assistant.message', at(14, 23, 30));
		seedEvent(db, 'lead', 'r4', 'run.failed', at(16, 9));
		seedToolCalls(db, 'chat', 'r5', at(15, 9, 5), ['Write']);

		seedChange(db, 'ws-malini', 'chat', 'r1', at(13, 12), [
			['src/app.ts', 10, 2],
			['README.md', 5, 0],
			['assets/logo.png', 0, 0],
		]);
		seedChange(db, 'ws-malini', 'job', 'r2', at(13, 11, 30), [['src/app.ts', 1, 1]]);
		seedChange(db, 'ws-secret', 'secret', 'r3', at(15, 1), [['src/model.py', 100, 0]]);

		const stats = await readPublishedStats(db, NOW, ['bestboyhq/malini'], (name) =>
			Promise.resolve(PUBLIC.includes(name)),
		);

		expect(stats).toEqual({
			version: 1,
			through: '2026-10-14',
			since: '2026-10-11',
			totals: {
				runs: 6,
				jobRuns: 1,
				changeRuns: 2,
				activeDays: 3,
				toolCalls: 11,
				screenshots: 2,
				workstreams: 6,
				mergedPullRequests: 1,
				linesAdded: 16,
				linesDeleted: 3,
				filesChanged: 3,
			},
			days: [
				{ date: '2026-10-11', runs: 1, agents: 1 },
				{ date: '2026-10-13', runs: 3, agents: 1.24 },
				{ date: '2026-10-14', runs: 2, agents: 1.33 },
			],
			intensity: {
				agents: { mean: 1.27, p50: 1, p90: 2, max: 2 },
				runSeconds: { p50: 600, p90: 7200, max: 7200 },
				steps: { p50: 0, p90: 9, max: 9 },
				runsPerActiveDay: { p50: 2, p90: 3, max: 3 },
				linesPerChange: { p50: 2 },
				runsPerWorkstream: { p50: 1 },
			},
			models: [
				{ name: 'opus', count: 2 },
				{ name: 'fable', count: 1 },
				{ name: 'haiku', count: 1 },
				{ name: 'other', count: 1 },
				{ name: 'sonnet', count: 1 },
			],
			languages: [
				{ name: 'TypeScript', count: 14 },
				{ name: 'Markdown', count: 5 },
			],
			tools: [
				{ name: 'Bash', count: 3 },
				{ name: 'Browser', count: 2 },
				{ name: 'MCP', count: 2 },
				{ name: 'Read', count: 2 },
				{ name: 'Skill', count: 1 },
				{ name: 'other', count: 1 },
			],
			mcpServers: [
				{ name: 'malini', count: 3 },
				{ name: 'other', count: 1 },
			],
			skills: [{ name: 'other', count: 1 }],
			repositories: [{ name: 'bestboyhq/malini', count: 2 }],
			otherRepositories: {
				public: { repositories: 1, runs: 1 },
				private: { repositories: 2, runs: 2 },
			},
		});
	});

	it('sends nothing before the first complete day with a run', async () => {
		const db = openMigratedDatabase(':memory:');
		seedGitHubRepository(db, 'bestboyhq/malini', 'ws-malini');
		seedSession(db, 'chat', 'ws-malini', 'user', 'opus');
		seedRun(db, 'today', 'chat', at(15, 8), at(15, 9));

		expect(await readPublishedStats(db, NOW, [], () => Promise.resolve(true))).toBeNull();
	});
});

function at(day: number, hour: number, minute = 0): string {
	return new Date(2026, 9, day, hour, minute).toISOString();
}

function seedGitHubRepository(
	db: MaliniDatabase,
	fullName: string,
	workstreamId: string,
	createdAt = at(1, 9),
): void {
	const projectId = `local__${fullName.replace('/', '__')}`;
	run(
		db,
		`INSERT INTO connected_repositories (id, full_name, default_branch, local_path, remote_url, created_at)
		 VALUES (?, ?, 'main', NULL, ?, ?)`,
		`connected-${projectId}`,
		fullName,
		`https://github.com/${fullName}.git`,
		at(1, 9),
	);
	seedProject(db, projectId);
	seedWorkstream(db, workstreamId, projectId, { createdAt });
}

function seedProject(db: MaliniDatabase, projectId: string): void {
	run(
		db,
		`INSERT INTO projects (id, name, repo_path, default_branch, created_at)
		 VALUES (?, ?, '/tmp/repo', 'main', ?)`,
		projectId,
		projectId,
		at(1, 9),
	);
}

function seedWorkstream(
	db: MaliniDatabase,
	workstreamId: string,
	projectId: string,
	options: Readonly<{ createdAt?: string; scope?: string; mergedAt?: string }> = {},
): void {
	run(
		db,
		`INSERT INTO workstreams
		   (id, project_id, name, path, branch, base_branch, status, created_at, scope,
		    archived_at, merged_pull_request_number, merged_pull_request_url)
		 VALUES (?, ?, ?, '/tmp/ws', 'malini/ws', 'main', ?, ?, ?, ?, ?, ?)`,
		workstreamId,
		projectId,
		workstreamId,
		options.mergedAt ? 'archived' : 'active',
		options.createdAt ?? at(1, 9),
		options.scope ?? null,
		options.mergedAt ?? null,
		options.mergedAt ? 7 : null,
		options.mergedAt ? 'https://github.com/bestboyhq/malini/pull/7' : null,
	);
}

function seedSession(
	db: MaliniDatabase,
	sessionId: string,
	workstreamId: string,
	origin: 'user' | 'job',
	model: string | null,
): void {
	run(
		db,
		`INSERT INTO agent_sessions (id, workstream_id, model, status, started_at, origin)
		 VALUES (?, ?, ?, 'idle', ?, ?)`,
		sessionId,
		workstreamId,
		model,
		at(1, 9),
		origin,
	);
}

function seedRun(
	db: MaliniDatabase,
	runId: string,
	sessionId: string,
	startedAt: string,
	completedAt: string,
	error: string | null = null,
): void {
	run(
		db,
		`INSERT INTO agent_runs (id, session_id, prompt, started_at, completed_at, error)
		 VALUES (?, ?, 'prompt', ?, ?, ?)`,
		runId,
		sessionId,
		startedAt,
		completedAt,
		error,
	);
}

function seedEvent(
	db: MaliniDatabase,
	sessionId: string,
	runId: string,
	kind: string,
	emittedAt: string,
	payload: unknown = {},
): void {
	run(
		db,
		'INSERT INTO agent_events (session_id, run_id, event, emitted_at) VALUES (?, ?, ?, ?)',
		sessionId,
		runId,
		`${kind}\n${JSON.stringify(payload)}`,
		emittedAt,
	);
}

function seedToolCalls(
	db: MaliniDatabase,
	sessionId: string,
	runId: string,
	emittedAt: string,
	tools: readonly string[],
): void {
	for (const tool of tools)
		seedEvent(db, sessionId, runId, 'tool.started', emittedAt, { name: tool });
}

function seedChange(
	db: MaliniDatabase,
	workstreamId: string,
	sessionId: string,
	runId: string,
	capturedAt: string,
	files: readonly (readonly [string, number, number])[],
): void {
	run(
		db,
		`INSERT INTO agent_checkpoints (id, workstream_id, session_id, run_id, git_ref, git_commit, created_at)
		 VALUES (?, ?, ?, ?, ?, 'before', ?)`,
		`checkpoint-${runId}`,
		workstreamId,
		sessionId,
		runId,
		`refs/malini/checkpoints/${runId}`,
		capturedAt,
	);
	run(
		db,
		`INSERT INTO agent_run_changes (run_id, checkpoint_id, before_commit, after_commit, after_ref, captured_at)
		 VALUES (?, ?, 'before', 'after', ?, ?)`,
		runId,
		`checkpoint-${runId}`,
		`refs/malini/changes/${runId}`,
		capturedAt,
	);
	for (const [path, additions, deletions] of files) {
		run(
			db,
			`INSERT INTO agent_run_change_files (run_id, path, additions, deletions, is_binary)
			 VALUES (?, ?, ?, ?, ?)`,
			runId,
			path,
			additions,
			deletions,
			additions + deletions === 0 ? 1 : 0,
		);
	}
}
