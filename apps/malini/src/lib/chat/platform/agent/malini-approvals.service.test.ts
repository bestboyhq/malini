import { describe, expect, it } from 'vitest';
import type { MaliniDatabase } from '$main/db/driver';
import { run } from '$main/db/rows';
import { rememberPermissionRule } from '../permissions.repository';
import { maliniActionFingerprint } from '../permissions.service';
import { openChatTestDatabase, seedChatSession, seedChatWorkstream } from '../test-support';
import { assessMaliniApproval, withMaliniApproval } from './malini-approvals.service';

const NOW = '2026-10-23T00:00:00.000Z';

function seedJob(db: MaliniDatabase, id: string, name: string, builtin: string | null = null) {
	run(
		db,
		`INSERT INTO job_definitions (id, name, instructions, model, effort, runs_in, output, skills, builtin, created_at, updated_at)
		 VALUES (?, ?, 'Do it.', 'opus', 'high', 'workstream', 'none', '[]', ?, ?, ?)`,
		id,
		name,
		builtin,
		NOW,
		NOW,
	);
}

function seedRoutine(db: MaliniDatabase, id: string, status: string, jobId: string) {
	run(
		db,
		`INSERT INTO routines (id, status, origin, label, trigger_when, steps_json, evidence_json, created_at, updated_at)
		 VALUES (?, ?, 'user', 'Docs after merge', 'when I run it', ?, '[]', ?, ?)`,
		id,
		status,
		JSON.stringify([{ job: jobId }]),
		NOW,
		NOW,
	);
}

function setup(): MaliniDatabase {
	const db = openChatTestDatabase();
	seedChatWorkstream(db, 'ws-1', '/tmp/ws-1');
	seedChatSession(db, 'sess-1', 'ws-1');
	seedJob(db, 'docs', 'Update docs', 'update-docs');
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
		expect(action(db, 'pull_requests_open_draft', {})).toBe('pull-requests.open-draft');
		expect(action(db, 'jobs_run', { job: 'release notes' })).toBe('jobs.run:notes');
		expect(action(db, 'jobs_run', { job: 'notes' })).toBe('jobs.run:notes');
		expect(action(db, 'jobs_save', { name: 'New', instructions: 'Go.' })).toBe('jobs.save');
		expect(action(db, 'jobs_save', { id: 'notes', instructions: 'Go.' })).toBe('jobs.save');
		expect(action(db, 'routines_save', { label: 'L', when: 'x', steps: ['Lint'] })).toBe(
			'routines.save',
		);
		db.close();
	});

	it('only asks once when it cannot tell which job or routine is meant', () => {
		const db = setup();
		expect(action(db, 'jobs_run', { job: 'Twin' })).toBeNull();
		expect(action(db, 'jobs_run', { job: 'Nope' })).toBeNull();
		expect(action(db, 'jobs_save', { id: 'nope' })).toBeNull();
		expect(action(db, 'routines_save', { id: 'nope' })).toBeNull();
		expect(assessMaliniApproval(db, 'Bash', { command: 'ls' })).toBeNull();
		db.close();
	});

	it('reviews an edit to a job that runs without asking: built in, always allowed, or in a promoted routine', () => {
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

		seedRoutine(db, 'draft-routine', 'draft', 'lint');
		expect(action(db, 'jobs_save', { id: 'lint', instructions: 'x' })).toBe('jobs.save');
		seedRoutine(db, 'live-routine', 'routine', 'lint');
		expect(action(db, 'jobs_save', { id: 'lint', instructions: 'x' })).toEqual({ review: 'job' });
		db.close();
	});

	it('reviews an edit to a promoted routine and lets a draft be saved like any other', () => {
		const db = setup();
		seedRoutine(db, 'draft-routine', 'draft', 'lint');
		seedRoutine(db, 'candidate-routine', 'candidate', 'lint');
		expect(action(db, 'routines_save', { id: 'draft-routine', when: 'y' })).toBe('routines.save');
		expect(action(db, 'routines_save', { id: 'candidate-routine', when: 'y' })).toEqual({
			review: 'routine',
		});
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
