import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { isRecord } from '$main/db/rows';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { upsertProject, upsertWorkstream } from '$shared/repositories/repositories.platform';
import { ChatDeliveries } from '../deliveries.service';
import { insertRun } from '../runs.repository';
import { insertSession } from '../sessions.repository';
import { PromptsInFlight } from './commands';
import { answerPlatformRequest, SENDS_PER_CHAIN, type PlatformRequestDeps } from './platform-tools';
import type { PlatformAnswer } from './protocol';

const NOW = '2026-10-28T09:00:00.000Z';

let db: MaliniDatabase;
let deps: PlatformRequestDeps;
let sent: Array<Record<string, unknown>>;

beforeEach(() => {
	db = openMigratedDatabase(':memory:');
	const events = createEventBus({ forwardToWindows: false });
	const commands = new CommandRegistry();
	sent = [];
	commands.define('chat.send-prompt', (args: unknown) => {
		if (!isRecord(args)) throw new Error('chat.send-prompt takes an object');
		sent.push(args);
		return `api-run-${sent.length}`;
	});
	upsertProject(db, {
		id: 'project',
		name: 'project',
		repoPath: '/tmp/project',
		defaultBranch: 'main',
		createdAt: NOW,
	});
	workstream('lead', 'Home', null, 'home');
	workstream('api', 'Api analytics', 'lead');
	workstream('other', 'Other work', null);
	for (const id of ['lead', 'api', 'other']) {
		insertSession(db, {
			id: `${id}-chat`,
			workstreamId: id,
			model: null,
			providerSessionId: null,
			status: 'idle',
			startedAt: NOW,
		});
	}
	userTurn('lead-run');
	deps = {
		db,
		commands,
		events,
		appDataRoot: '/tmp/malini-app-data',
		sending: new PromptsInFlight(),
		deliveries: new ChatDeliveries({ db, commands, events }, () => {}),
		log: () => {},
	};
});

afterEach(() => {
	deps.deliveries.stop();
	db.close();
});

function workstream(id: string, name: string, startedBy: string | null, scope?: string): void {
	upsertWorkstream(db, {
		id,
		projectId: 'project',
		name,
		path: `/tmp/${id}`,
		branch: `malini/${id}`,
		baseBranch: 'main',
		status: 'active',
		createdAt: NOW,
		scope: scope ?? null,
		startedBy,
	});
}

function userTurn(id: string): void {
	insertRun(db, {
		id,
		sessionId: 'lead-chat',
		prompt: 'Ship analytics',
		startedAt: NOW,
		completedAt: null,
		summary: null,
		error: null,
	});
}

function output(answer: PlatformAnswer): unknown {
	return JSON.parse(answer.text ?? 'null');
}

function send(workstream: string, prompt: string, runId = 'lead-run'): Promise<PlatformAnswer> {
	return answerPlatformRequest(
		{
			type: 'bridge.platform_request',
			protocolVersion: 43,
			requestId: `platform-${runId}`,
			sessionId: 'lead-chat',
			runId,
			tool: 'workstreams_send',
			input: { workstream, prompt },
		},
		deps,
	);
}

describe('workstreams_send', () => {
	it('delivers into the chat of a workstream this chat started, as a prompt from it', async () => {
		const answer = await send('Api analytics', 'Use the acme Logdash project.');

		expect(answer.ok).toBe(true);
		expect(output(answer)).toMatchObject({
			id: 'api',
			chat: 'api-chat',
			delivery: { status: 'delivered' },
		});
		expect(sent).toEqual([
			expect.objectContaining({
				sessionId: 'api-chat',
				prompt: 'Use the acme Logdash project.',
				from: 'lead',
				chainId: 'lead-run',
			}),
		]);
	});

	it('refuses a workstream this chat did not start', async () => {
		const answer = await send('Other work', 'Rename the button.');

		expect(answer.ok).toBe(false);
		expect(answer.error).toContain('This chat did not start “Other work”');
		expect(sent).toEqual([]);
	});

	it('stops after six prompts to one workstream in one chain, and counts anew once the user writes', async () => {
		for (let index = 0; index < SENDS_PER_CHAIN; index += 1) {
			expect((await send('Api analytics', `Step ${index + 1}`)).ok).toBe(true);
		}

		const over = await send('Api analytics', 'One more step');
		expect(over.ok).toBe(false);
		expect(over.error).toContain(
			'You already sent “Api analytics” 6 prompts since the user last wrote',
		);
		expect(sent).toHaveLength(SENDS_PER_CHAIN);

		userTurn('lead-run-2');
		expect((await send('Api analytics', 'Go on', 'lead-run-2')).ok).toBe(true);
		expect(sent).toHaveLength(SENDS_PER_CHAIN + 1);
	});
});
