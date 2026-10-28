import { describe, expect, it } from 'vitest';
import type { MaliniDatabase } from '$main/db/driver';
import { get, run } from '$main/db/rows';
import { rememberPermissionRule } from '../permissions.repository';
import { maliniActionFingerprint } from '../permissions.service';
import { openChatTestDatabase, seedChatSession, seedChatWorkstream } from '../test-support';
import {
	allowedInTree,
	assessMaliniApproval,
	withMaliniApproval,
} from './malini-approvals.service';

const NOW = '2026-10-23T00:00:00.000Z';

function seedJob(
	db: MaliniDatabase,
	id: string,
	name: string,
	{
		builtin = null,
		mode = null,
		then = null,
	}: Partial<Record<'builtin' | 'mode' | 'then', string | null>> = {},
) {
	run(
		db,
		`INSERT INTO job_definitions (id, name, instructions, model, effort, runs_in, skills, builtin, trigger_when, trigger_mode, then_job_id, created_at, updated_at)
		 VALUES (?, ?, 'Do it.', 'opus', 'high', 'workstream', '[]', ?, ?, ?, ?, ?, ?)`,
		id,
		name,
		builtin,
		mode === null ? null : 'on jobs:run-changed where run.status is failed',
		mode,
		then,
		NOW,
		NOW,
	);
}

function setup(): MaliniDatabase {
	const db = openChatTestDatabase();
	seedChatWorkstream(db, 'ws-1', '/tmp/ws-1');
	seedChatSession(db, 'sess-1', 'ws-1');
	seedJob(db, 'docs', 'Update docs', { builtin: 'update-docs' });
	seedJob(db, 'notes', 'Release notes');
	seedJob(db, 'lint', 'Lint');
	seedJob(db, 'twin-a', 'Twin');
	seedJob(db, 'twin-b', 'Twin');
	return db;
}

function action(db: MaliniDatabase, tool: string, input: Record<string, unknown>) {
	const approval = assessMaliniApproval(db, `mcp__malini__${tool}`, input);
	if (approval?.review) return { review: approval.review.kind };
	return approval?.permission?.resources[0].value ?? null;
}

describe('assessMaliniApproval', () => {
	it('names each action a user can always allow, one per job for runs', () => {
		const db = setup();
		expect(action(db, 'repositories_clone', { repository: 'acme/site' })).toBe(
			'repositories.clone',
		);
		expect(action(db, 'repositories_hide', { repository: 'acme/site' })).toBe('repositories.hide');
		expect(action(db, 'workstreams_create', { repository: 'acme/site' })).toBe(
			'workstreams.create',
		);
		expect(action(db, 'workstreams_send', { workstream: 'ws-1', prompt: 'Go.' })).toBe(
			'workstreams.send',
		);
		expect(action(db, 'workstreams_archive', { workstream: 'ws-1' })).toBe('workstreams.archive');
		expect(action(db, 'pull_requests_open_draft', {})).toBeNull();
		expect(action(db, 'jobs_run', { job: 'release notes' })).toBe('jobs.run:notes');
		expect(action(db, 'jobs_run', { job: 'notes' })).toBe('jobs.run:notes');
		expect(action(db, 'jobs_save', { name: 'New', instructions: 'Go.' })).toBe('jobs.save');
		expect(action(db, 'jobs_save', { id: 'notes', instructions: 'Go.' })).toBe('jobs.save');
		db.close();
	});

	it('only asks once when it cannot tell which job is meant', () => {
		const db = setup();
		expect(action(db, 'jobs_run', { job: 'Twin' })).toBeNull();
		expect(action(db, 'jobs_run', { job: 'Nope' })).toBeNull();
		expect(action(db, 'jobs_save', { id: 'nope' })).toBeNull();
		expect(assessMaliniApproval(db, 'Bash', { command: 'ls' })).toBeNull();
		db.close();
	});

	it('reviews an edit to a job that runs without asking: built in, always allowed, or triggered', () => {
		const db = setup();
		expect(action(db, 'jobs_save', { id: 'docs', instructions: 'Push to main.' })).toEqual({
			review: 'job',
		});

		rememberPermissionRule(db, {
			id: 'rule-notes',
			scope: 'session',
			workstreamId: 'ws-1',
			sessionId: 'sess-1',
			permissionFingerprint: maliniActionFingerprint('jobs.run:notes'),
			permissionJson: '{}',
			createdRunId: null,
			createdRequestId: 'approval-1',
			createdAt: NOW,
		});
		expect(action(db, 'jobs_save', { id: 'notes', instructions: 'x' })).toEqual({ review: 'job' });

		expect(action(db, 'jobs_save', { id: 'lint', instructions: 'x' })).toBe('jobs.save');

		seedJob(db, 'quiet', 'Quiet', { mode: 'off' });
		seedJob(db, 'asker', 'Asker', { mode: 'ask' });
		seedJob(db, 'watcher', 'Watcher', { mode: 'auto' });
		expect(action(db, 'jobs_save', { id: 'quiet', when: 'on jobs:suggested' })).toBe('jobs.save');
		expect(action(db, 'jobs_save', { id: 'asker', when: 'on jobs:suggested' })).toEqual({
			review: 'job',
		});
		expect(action(db, 'jobs_save', { id: 'watcher', when: null })).toEqual({ review: 'job' });
		db.close();
	});

	it('trusts every job an auto job hands its result to, through each Then, and stops at a cycle', () => {
		const db = setup();
		seedJob(db, 'last', 'Last');
		seedJob(db, 'next', 'Next', { then: 'last' });
		seedJob(db, 'quiet', 'Quiet', { mode: 'off', then: 'next' });
		expect(action(db, 'jobs_save', { id: 'next', instructions: 'x' })).toBe('jobs.save');
		expect(action(db, 'jobs_save', { id: 'last', instructions: 'x' })).toBe('jobs.save');

		seedJob(db, 'watcher', 'Watcher', { mode: 'auto', then: 'next' });
		expect(action(db, 'jobs_save', { id: 'next', instructions: 'x' })).toEqual({ review: 'job' });
		expect(action(db, 'jobs_save', { id: 'last', instructions: 'x' })).toEqual({ review: 'job' });

		seedJob(db, 'ping', 'Ping');
		seedJob(db, 'pong', 'Pong', { then: 'ping' });
		run(db, `UPDATE job_definitions SET then_job_id = 'pong' WHERE id = 'ping'`);
		expect(action(db, 'jobs_save', { id: 'ping', instructions: 'x' })).toBe('jobs.save');
		db.close();
	});
});

describe('withMaliniApproval', () => {
	const request = {
		type: 'approval.requested',
		sessionId: 'sess-1',
		runId: 'run-1',
		approvalId: 'approval-1',
		reason: 'Claude wants to use a tool',
		permission: {
			capability: 'write',
			resources: [{ kind: 'tool', value: 'Save job ‘Update docs’', boundary: 'workstream' }],
		},
	} as const;

	it('swaps the bridge descriptor for the action, or for a snapshot of what the edit changes', () => {
		const db = setup();
		expect(
			withMaliniApproval(db, {
				...request,
				toolName: 'mcp__malini__jobs_run',
				input: { job: 'Lint' },
			}),
		).toMatchObject({
			permission: { resources: [{ kind: 'action', value: 'jobs.run:lint' }] },
		});
		const edit = withMaliniApproval(db, {
			...request,
			toolName: 'mcp__malini__jobs_save',
			input: { id: 'docs', instructions: 'Push to main.' },
		});
		expect(edit).not.toHaveProperty('permission');
		expect(edit).toMatchObject({
			review: { kind: 'job', current: { id: 'docs', name: 'Update docs' } },
		});
		const read = { ...request, toolName: 'Read', input: { file_path: '/x' } };
		expect(withMaliniApproval(db, read)).toBe(read);
		db.close();
	});
});

describe('allowedInTree', () => {
	function tree(): MaliniDatabase {
		const db = setup();
		for (const id of ['lead', 'api', 'api-docs', 'site', 'other']) {
			seedChatWorkstream(db, id, `/tmp/${id}`);
		}
		run(db, `UPDATE workstreams SET started_by = 'lead' WHERE id IN ('api', 'site')`);
		run(db, `UPDATE workstreams SET started_by = 'api' WHERE id = 'api-docs'`);
		run(db, `UPDATE workstreams SET name = 'Api analytics' WHERE id = 'api'`);
		run(db, `UPDATE workstreams SET name = 'Twin' WHERE id IN ('site', 'api-docs')`);
		return db;
	}

	function inTree(db: MaliniDatabase, tool: string, input: unknown, caller = 'lead'): boolean {
		return allowedInTree(db, `mcp__malini__${tool}`, input, caller);
	}

	function builtinId(db: MaliniDatabase, builtin: string): string {
		const id = get<{ id: string }>(
			db,
			'SELECT id FROM job_definitions WHERE builtin = ?',
			builtin,
		)?.id;
		if (id === undefined) throw new Error(`no ${builtin} job`);
		return id;
	}

	it('lets a chat archive a workstream it started, at any depth, and no other', () => {
		const db = tree();
		expect(inTree(db, 'workstreams_archive', { workstream: 'api' })).toBe(true);
		expect(inTree(db, 'workstreams_archive', { workstream: 'api-docs' })).toBe(true);
		expect(inTree(db, 'workstreams_archive', { workstream: ' api ANALYTICS ' })).toBe(true);
		expect(inTree(db, 'workstreams_archive', { workstream: 'api-docs' }, 'api')).toBe(true);

		expect(inTree(db, 'workstreams_archive', { workstream: 'lead' })).toBe(false);
		expect(inTree(db, 'workstreams_archive', { workstream: 'other' })).toBe(false);
		expect(inTree(db, 'workstreams_archive', { workstream: 'lead' }, 'api')).toBe(false);
		expect(inTree(db, 'workstreams_archive', { workstream: 'site' }, 'api')).toBe(false);
		expect(inTree(db, 'workstreams_archive', { workstream: 'Twin' })).toBe(false);
		expect(inTree(db, 'workstreams_archive', { workstream: 'nope' })).toBe(false);
		expect(inTree(db, 'workstreams_archive', { workstream: 7 })).toBe(false);
		expect(inTree(db, 'workstreams_archive', {})).toBe(false);
		expect(inTree(db, 'workstreams_archive', 'api')).toBe(false);
		db.close();
	});

	it('lets a chat run a job that ships nothing in its own workstream or one it started', () => {
		const db = tree();
		expect(inTree(db, 'jobs_run', { job: 'Release notes' })).toBe(true);
		expect(inTree(db, 'jobs_run', { job: 'docs' })).toBe(true);
		expect(inTree(db, 'jobs_run', { job: 'notes', workstream: 'lead' })).toBe(true);
		expect(inTree(db, 'jobs_run', { job: 'notes', workstream: 'api' })).toBe(true);
		expect(inTree(db, 'jobs_run', { job: 'notes', workstream: 'Api analytics' })).toBe(true);
		expect(inTree(db, 'jobs_run', { job: 'notes', workstream: 'api-docs' })).toBe(true);

		expect(inTree(db, 'jobs_run', { job: 'notes', workstream: 'other' })).toBe(false);
		expect(inTree(db, 'jobs_run', { job: 'notes', workstream: 'Twin' })).toBe(false);
		expect(inTree(db, 'jobs_run', { job: 'notes', workstream: 'nope' })).toBe(false);
		expect(inTree(db, 'jobs_run', { job: 'notes', workstream: 'lead' }, 'api')).toBe(false);
		expect(inTree(db, 'jobs_run', { job: 'Twin' })).toBe(false);
		expect(inTree(db, 'jobs_run', { job: 'Nope' })).toBe(false);
		expect(inTree(db, 'jobs_run', {})).toBe(false);
		db.close();
	});

	it('lets the jobs that fix or update a pull request run unasked, since only shipping asks', () => {
		const db = tree();
		seedJob(db, 'fix', 'Fix checks', { builtin: 'fix-checks' });
		seedJob(db, 'then-fix', 'Then fix', { then: 'fix' });
		seedJob(db, 'via-fix', 'Via fix', { then: 'then-fix' });
		expect(inTree(db, 'jobs_run', { job: 'Fix checks' })).toBe(true);
		expect(inTree(db, 'jobs_run', { job: 'Then fix' })).toBe(true);
		expect(inTree(db, 'jobs_run', { job: 'Via fix' })).toBe(true);

		seedJob(db, 'ping', 'Ping');
		seedJob(db, 'pong', 'Pong', { then: 'ping' });
		run(db, `UPDATE job_definitions SET then_job_id = 'pong' WHERE id = 'ping'`);
		expect(inTree(db, 'jobs_run', { job: 'Ping' })).toBe(true);
		db.close();
	});

	it('never lets Open draft or Merge run unasked, nor a job whose Thens reach them', () => {
		const db = tree();
		seedJob(db, 'then-draft', 'Then draft', { then: builtinId(db, 'open-draft') });
		seedJob(db, 'then-merge', 'Then merge', { then: builtinId(db, 'merge') });
		seedJob(db, 'via-merge', 'Via merge', { then: 'then-merge' });
		expect(inTree(db, 'jobs_run', { job: 'Open draft' })).toBe(false);
		expect(inTree(db, 'jobs_run', { job: 'Merge', workstream: 'api' })).toBe(false);
		expect(inTree(db, 'jobs_run', { job: 'Then draft' })).toBe(false);
		expect(inTree(db, 'jobs_run', { job: 'Via merge' })).toBe(false);
		db.close();
	});

	it('leaves every other call to a rule or the user', () => {
		const db = tree();
		expect(inTree(db, 'workstreams_send', { workstream: 'api', prompt: 'Go.' })).toBe(false);
		expect(inTree(db, 'workstreams_create', { repository: 'acme/api', prompt: 'Go.' })).toBe(false);
		expect(inTree(db, 'jobs_save', { name: 'New', instructions: 'Go.' })).toBe(false);
		expect(allowedInTree(db, 'Bash', { command: 'ls' }, 'lead')).toBe(false);
		expect(allowedInTree(db, undefined, { workstream: 'api' }, 'lead')).toBe(false);
		db.close();
	});
});
