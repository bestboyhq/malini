import { expect, it } from 'vitest';
import { openMigratedDatabase } from '$main/db/open';
import {
	getWorkstream,
	upsertProject,
	upsertWorkstream,
} from '$shared/repositories/repositories.platform';
import { finalizeRunLifecycle, insertRun } from '../runs.repository';
import { getSession, insertSession } from '../sessions.repository';
import { ChatNamer } from './naming';

const NOW = '2026-11-14T09:00:00.000Z';
const SUITE = 'Run the e2e suite in the background and tell me how it ends.';
const QUESTION = 'Is that suite still running? Answer in one line.';

it('refines the name from the message that named the chat, when a prompt sent during a wait carries the turn', async () => {
	const db = openMigratedDatabase(':memory:');
	upsertProject(db, {
		id: 'project',
		name: 'project',
		repoPath: '/tmp/project',
		defaultBranch: 'main',
		createdAt: NOW,
	});
	upsertWorkstream(db, {
		id: 'ws-1',
		projectId: 'project',
		name: 'New workstream',
		path: '/tmp/ws-1',
		branch: 'malini/ws-1',
		baseBranch: 'main',
		status: 'active',
		createdAt: NOW,
		startedBy: null,
	});
	insertSession(
		db,
		{
			id: 'chat',
			workstreamId: 'ws-1',
			provider: 'claude',
			model: null,
			providerSessionId: null,
			status: 'idle',
			startedAt: NOW,
		},
		{ origin: 'user', displayName: 'New chat' },
	);
	const asked: string[] = [];
	const namer = new ChatNamer(
		db,
		async (task) => {
			asked.push(task);
			return task.includes('<reply>') ? 'E2E suite result' : 'E2E suite run';
		},
		{ chat: () => undefined, workstream: () => undefined },
		() => undefined,
	);

	namer.promptSent('chat', 'ws-1', SUITE);
	await namer.settled();
	for (const [id, prompt, summary] of [
		['run-1', SUITE, 'The suite runs. I wait for it.'],
		['run-2', QUESTION, 'The suite passed.\n\nOutcome: The e2e suite passes\nNeeds: nothing'],
	] as const) {
		insertRun(db, {
			id,
			sessionId: 'chat',
			prompt,
			startedAt: NOW,
			completedAt: null,
			summary: null,
			error: null,
		});
		finalizeRunLifecycle(db, 'chat', id, 'completed', summary, null, NOW);
	}
	namer.promptSent('chat', 'ws-1', QUESTION);
	namer.turnFinished({
		workstreamId: 'ws-1',
		sessionId: 'chat',
		runId: 'run-2',
		status: 'succeeded',
		outcome: 'The e2e suite passes',
		needs: null,
		backgroundCommands: null,
	});
	await namer.settled();

	expect(asked).toHaveLength(2);
	expect(asked[1]).toContain(SUITE);
	expect(asked[1]).not.toContain(QUESTION);
	expect(getSession(db, 'chat')?.displayName).toBe('E2E suite result');
	expect(getWorkstream(db, 'ws-1')?.name).toBe('E2E suite result');
});
