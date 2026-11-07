import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEventEnvelope } from '$contract/agent';
import { PAUSED_FOR_EXIT_ERROR } from '$contract/agent-state-machine';
import {
	APP_UPDATED_CHANNEL,
	CHAT_AGENT_EVENT_CHANNEL,
	CHAT_TURN_FINISHED_CHANNEL,
	AUTOMATIONS_DEFINITION_CHANGED_CHANNEL,
	AUTOMATIONS_RUN_CHANGED_CHANNEL,
	AUTOMATIONS_RUN_FINISHED_CHANNEL,
	AUTOMATIONS_RUN_STARTED_CHANNEL,
	AUTOMATIONS_SUGGESTED_CHANNEL,
} from '$contract/events';
import type { CommandFailure } from '$contract/ipc';
import {
	DEFAULT_AUTOMATION_BOUNDARY,
	AUTOMATIONS_MAX_CONCURRENT_SETTING,
	type AutomationBuiltin,
	type AutomationDefinitionRecord,
	type AutomationRunRecord,
	type AutomationRunStatus,
	type AutomationSuggestionRecord,
	type AutomationTrigger,
	type RunAutomationArgs,
	type SaveAutomationDefinitionArgs,
} from '$contract/automations';
import type { ShipStateRecord } from '$contract/pull-requests';
import type { WorktreeStatus } from '$contract/repositories';
import type { MainContext } from '$main/context';
import { openDatabase, type MaliniDatabase } from '$main/db/driver';
import { BASELINE_USER_VERSION, SCHEMA, migrate } from '$main/db/migrations';
import { openMigratedDatabase } from '$main/db/open';
import { all, get } from '$main/db/rows';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { insertRun } from '$lib/chat/platform/runs.repository';
import { insertSession } from '$lib/chat/platform/sessions.repository';
import { addressedReviewThreadIds } from '$lib/pull-requests/domain/pull-request-fix-prompt';
import {
	upsertConnectedRepository,
	upsertProject,
	upsertWorkstream,
} from '$shared/repositories/repositories.platform';
import type { AutomationsPlatform } from '../automations.platform';
import { BUILTIN_AUTOMATIONS } from '../domain/builtin-automations';
import { updateFromMainAutomationContext } from '../domain/update-from-main-context';
import { insertLoggedEvent, automationRunEventIds } from './event-log.repository';
import { getBuiltinAutomationDefinition } from './automation-definitions.repository';
import { BUSY_RETRY_MS } from './automation-runner.service';
import {
	getAutomationRun,
	getAutomationRunContext,
	insertAutomationRun,
} from './automation-runs.repository';
import { registerAutomations } from './register';
import { skillsForRun } from '$lib/skills/skills.platform';

const NOW = '2026-10-11T00:00:00.000Z';

let db: MaliniDatabase;
let context: MainContext;
let automations: AutomationsPlatform;
let settings: Record<string, string>;
let openRuns: Set<string>;
let sessionEvents: Map<string, AgentEventEnvelope[]>;
let definitionEvents: unknown[];
let suggested: AutomationSuggestionRecord[];
let answers: ReturnType<typeof vi.fn<(task: string) => Promise<Record<string, unknown>>>>;
let fakes: ReturnType<typeof createFakes>;
let seq = 0;

function createFakes() {
	let sessions = 0;
	let agentRuns = 0;
	return {
		startSession: vi.fn((_args: unknown): string => `session-${++sessions}`),
		sendPrompt: vi.fn((_args: unknown): string => `agent-run-${++agentRuns}`),
		cancelRun: vi.fn((_args: unknown): undefined => undefined),
		openDraft: vi.fn((_args: unknown): Promise<ShipStateRecord> => Promise.resolve(shipState())),
		queueMerge: vi.fn((_args: unknown): Promise<ShipStateRecord> => Promise.resolve(shipState())),
		createWorkstream: vi.fn((_args: unknown): string => '/tmp/new-workstream'),
		syncBase: vi.fn((_args: unknown) => 'current' as const),
		provision: vi.fn((_args: unknown) => ({ status: 'succeeded' as const })),
		workstreamStatus: vi.fn((_args: unknown): WorktreeStatus => worktree()),
		countBehind: vi.fn((_args: unknown): number | Promise<number> => 0),
		pull: vi.fn((_args: unknown): string => 'abc1234'),
	};
}

function harness(database: MaliniDatabase): MainContext {
	const events = createEventBus({ forwardToWindows: false });
	const commands = new CommandRegistry();
	fakes = createFakes();
	events.subscribe(AUTOMATIONS_DEFINITION_CHANGED_CHANNEL, (payload) =>
		definitionEvents.push(payload),
	);
	events.subscribe(AUTOMATIONS_SUGGESTED_CHANNEL, ({ suggestion }) => suggested.push(suggestion));
	commands.define('app.list-settings', () => settings);
	commands.define('chat.workstream-has-working-run', (args: unknown) =>
		openRuns.has(String(Reflect.get(Object(args), 'workstreamId'))),
	);
	commands.define('chat.start-session', fakes.startSession);
	commands.define('chat.send-prompt', fakes.sendPrompt);
	commands.define('chat.cancel-run', fakes.cancelRun);
	commands.define('chat.list-events', (args: unknown) => [
		...(sessionEvents.get(String(Reflect.get(Object(args), 'sessionId'))) ?? []),
	]);
	commands.define('chat.decide-approval', () => ({
		decision: 'allow',
		scope: 'once',
		remembered: false,
	}));
	commands.define('chat.answer-question', () => undefined);
	commands.define('pull-requests.open-draft', fakes.openDraft);
	commands.define('pull-requests.queue-merge', fakes.queueMerge);
	commands.define('repositories.create-workstream', fakes.createWorkstream);
	commands.define('repositories.sync-workstream-base', fakes.syncBase);
	commands.define('repositories.provision-dependencies', fakes.provision);
	commands.define('repositories.workstream-status', fakes.workstreamStatus);
	commands.define('repositories.count-behind-base', fakes.countBehind);
	commands.define('repositories.pull-workstream', fakes.pull);
	return {
		db: database,
		commands,
		events,
		appDataRoot: '/tmp/automations-test',
		checkoutsRoot: '/tmp/automations-test',
		resourcesRoot: '/tmp/automations-test',
		isDev: true,
		appVersion: '0.0.0-test',
	};
}

beforeEach(() => {
	db = openMigratedDatabase(':memory:');
	settings = {};
	openRuns = new Set();
	sessionEvents = new Map();
	definitionEvents = [];
	suggested = [];
	for (const workstreamId of ['ws-a', 'ws-b', 'ws-c', 'ws-d']) seedWorkstream(workstreamId);
	context = harness(db);
	answers = vi.fn<(task: string) => Promise<Record<string, unknown>>>();
	automations = registerAutomations(context, { log: () => {}, answer: (task) => answers(task) });
	automations.start();
});

afterEach(() => {
	vi.useRealTimers();
	automations.dispose();
	db.close();
});

function defaults(name: string, effort: string, model = 'opus') {
	return { name, effort, model, runsIn: 'workstream', trigger: null, thenAutomationId: null };
}

function shipState(): ShipStateRecord {
	return {
		workstreamId: 'ws-a',
		phase: 'draft',
		step: null,
		keep: false,
		pullRequestNumber: null,
		pullRequestUrl: null,
		needsYou: null,
		queuedAt: null,
		attempts: 0,
		checks: [],
		activeAutomationRunId: null,
		lastError: null,
		githubSaid: null,
		failures: 0,
		failedSince: null,
		nextAttemptAt: null,
		waitsFor: null,
		updatedAt: NOW,
	};
}

function worktree(overrides: Partial<WorktreeStatus> = {}): WorktreeStatus {
	return {
		branch: 'malini/ws-a',
		dirtyPaths: [],
		conflictedPaths: [],
		conflictMarkerPaths: [],
		ahead: 0,
		behind: 0,
		hasUpstream: true,
		mergeInProgress: false,
		operationInProgress: null,
		headSha: 'a'.repeat(40),
		...overrides,
	};
}

function conflictedMerge(): WorktreeStatus {
	return worktree({
		dirtyPaths: ['src/shared.ts'],
		conflictedPaths: ['src/shared.ts'],
		conflictMarkerPaths: ['src/shared.ts'],
		mergeInProgress: true,
		operationInProgress: 'merge',
	});
}

function seedWorkstream(workstreamId: string): void {
	upsertProject(db, {
		id: 'project',
		name: 'project',
		repoPath: '/tmp/project',
		defaultBranch: 'main',
		createdAt: NOW,
	});
	upsertWorkstream(db, {
		id: workstreamId,
		projectId: 'project',
		name: workstreamId,
		path: `/tmp/${workstreamId}`,
		branch: `malini/${workstreamId}`,
		baseBranch: 'main',
		status: 'active',
		createdAt: NOW,
		scope: null,
		startedBy: null,
	});
}

function agentEvent(sessionId: string, runId: string, event: Record<string, unknown>): void {
	seq += 1;
	context.events.emit(CHAT_AGENT_EVENT_CHANNEL, {
		sessionId,
		runId,
		seq,
		event: { runId, ...event },
	});
}

async function builtin(key: AutomationBuiltin): Promise<AutomationDefinitionRecord> {
	const definitions = await context.commands.call('automations.list-definitions', undefined);
	const found = definitions.find((definition) => definition.builtin === key);
	if (!found) throw new Error(`missing built-in ${key}`);
	return found;
}

function saveDefinition(
	overrides: Partial<SaveAutomationDefinitionArgs> = {},
): Promise<AutomationDefinitionRecord> {
	return context.commands.call('automations.save-definition', {
		name: 'Write changelog',
		instructions: 'Write the changelog entry.',
		provider: 'claude',
		model: 'opus',
		effort: 'low',
		runsIn: 'workstream',
		...overrides,
	});
}

async function runOf(
	definition: AutomationDefinitionRecord,
	args: Omit<RunAutomationArgs, 'definitionId'> = {},
): Promise<AutomationRunRecord> {
	return context.commands.call('automations.run', {
		definitionId: definition.id,
		workstreamId: 'ws-a',
		...args,
	});
}

function complete(sessionId: string, summary: string): void {
	agentEvent(sessionId, 'agent-run-1', { type: 'run.completed', summary });
}

async function runFixChecks(workstreamId: string): Promise<AutomationRunRecord> {
	const definition = await builtin('fix-checks');
	return context.commands.call('automations.run', { definitionId: definition.id, workstreamId });
}

async function automationRun(id: string): Promise<AutomationRunRecord> {
	const found = (await context.commands.call('automations.list-runs', undefined)).find(
		(entry) => entry.id === id,
	);
	if (!found) throw new Error(`missing automation run ${id}`);
	return found;
}

async function until(id: string, status: AutomationRunStatus): Promise<AutomationRunRecord> {
	await vi.waitFor(async () => expect((await automationRun(id)).status).toBe(status));
	return automationRun(id);
}

async function session(id: string): Promise<string> {
	await vi.waitFor(async () =>
		expect(await automationRun(id)).toMatchObject({
			status: 'running',
			sessionId: expect.any(String),
			agentRunId: expect.any(String),
		}),
	);
	const { sessionId } = await automationRun(id);
	if (sessionId === null) throw new Error(`automation run ${id} has no session`);
	return sessionId;
}

function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 20));
}

async function failure(command: string, args: unknown): Promise<CommandFailure> {
	const reply = await context.commands.handle({ command, args });
	if (reply.ok) throw new Error(`${command} unexpectedly succeeded`);
	return reply.failure;
}

describe('automation definitions', () => {
	it('seeds every built-in automation once, with its defaults and Update docs then Open draft', async () => {
		const second = registerAutomations(harness(db), { log: () => {} });
		second.dispose();

		const definitions = await context.commands.call('automations.list-definitions', undefined);
		const openDraft = await builtin('open-draft');
		expect(definitions).toHaveLength(Object.keys(BUILTIN_AUTOMATIONS).length);
		expect(
			Object.fromEntries(
				definitions.map(
					({ builtin: key, name, effort, model, runsIn, trigger, thenAutomationId }) => [
						key,
						{ name, effort, model, runsIn, trigger, thenAutomationId },
					],
				),
			),
		).toEqual({
			'name-chats': defaults('Name chats', 'low', 'haiku'),
			'name-services': defaults('Name services', 'low', 'haiku'),
			'fix-checks': defaults('Fix checks', 'high'),
			'update-from-main': {
				...defaults('Update from main', 'low'),
				trigger: {
					when: 'on repositories:workstream-base-overlapped where overlapping is true',
					mode: 'auto',
				},
			},
			'resolve-conflicts': {
				...defaults('Resolve conflicts', 'high'),
				trigger: { when: 'on repositories:workstream-merge-conflicted', mode: 'auto' },
			},
			'address-review': {
				...defaults('Address review', 'medium'),
				trigger: {
					when: 'on pull-requests:pull-request-changed where reviewDecision is changes_requested',
					mode: 'auto',
				},
			},
			'check-compatibility': defaults('Check compatibility', 'high'),
			'update-docs': {
				...defaults('Update docs', 'high'),
				runsIn: 'new-workstream',
				thenAutomationId: openDraft.id,
			},
			'open-draft': defaults('Open draft', 'low'),
			merge: defaults('Merge', 'low'),
			reconcile: defaults('Choose a reaction', 'low', 'haiku'),
			'suggest-automations': defaults('Suggest automations', 'low', 'haiku'),
			'capture-brain': {
				...defaults('Capture to the log', 'low'),
				trigger: { when: 'on repositories:workstream-removed where archived is set', mode: 'off' },
			},
			'write-brain-notes': {
				...defaults('Write the notes', 'medium'),
				trigger: { when: 'every sunday at 18:00', mode: 'off' },
			},
		});
	});

	it('holds the built-in rows the migration writes exactly as the code defines them', () => {
		const old = openDatabase(':memory:');
		old.exec(SCHEMA);
		old.exec(`PRAGMA user_version = ${BASELINE_USER_VERSION};`);
		old.exec(`INSERT INTO job_definitions (id, name, instructions, model, effort, runs_in, output, builtin, created_at, updated_at)
			VALUES ('main', 'Update from main', 'Old.', 'opus', 'high', 'workstream', 'none', 'update-from-main', '${NOW}', '${NOW}')`);
		migrate(old);
		const fresh = openMigratedDatabase(':memory:');

		for (const [database, key] of [
			[fresh, 'open-draft'],
			[fresh, 'merge'],
			[old, 'update-from-main'],
		] as const) {
			const { name, instructions, effort, model } = BUILTIN_AUTOMATIONS[key];
			expect(getBuiltinAutomationDefinition(database, key), key).toMatchObject({
				name,
				instructions,
				effort,
				model,
			});
		}
		old.close();
		fresh.close();
	});

	it('resets Update docs to run in a new workstream, then Open draft, with no trigger', async () => {
		const docs = await builtin('update-docs');
		const merge = await builtin('merge');
		await saveDefinition({
			id: docs.id,
			name: 'Docs',
			runsIn: 'workstream',
			trigger: { when: 'on pull-requests:ship-changed where merged is set', mode: 'auto' },
			thenAutomationId: merge.id,
		});

		const reset = await context.commands.call('automations.reset-definition', {
			definitionId: docs.id,
		});

		expect(reset).toMatchObject({
			name: 'Update docs',
			runsIn: 'new-workstream',
			trigger: null,
			thenAutomationId: (await builtin('open-draft')).id,
		});
	});

	it('checks compatibility in the newest workstream once when malini updates, through its rule, even when it hears the update again after a restart', async () => {
		const definition = await builtin('check-compatibility');
		upsertWorkstream(db, {
			id: 'ws-newest',
			projectId: 'project',
			name: 'ws-newest',
			path: '/tmp/ws-newest',
			branch: 'malini/ws-newest',
			baseBranch: 'main',
			status: 'active',
			createdAt: '2026-10-12T00:00:00.000Z',
			scope: null,
			startedBy: null,
		});
		const changes = {
			added: ['app:updated'],
			removed: [],
			changed: [
				{ channel: 'automations:run-changed', before: 'type A = 1;', after: 'type A = 2;' },
			],
		};

		context.events.emit(APP_UPDATED_CHANNEL, { from: '0.1.0', to: '0.2.0', changes });

		const run = await vi.waitFor(async () => {
			const runs = await context.commands.call('automations.list-runs', undefined);
			const found = runs.find((entry) => entry.definitionId === definition.id);
			if (!found) throw new Error('no compatibility run yet');
			return found;
		});
		expect(run).toMatchObject({ workstreamId: 'ws-newest', origin: 'compatibility' });
		expect(automationRunEventIds(db, [run.id]).get(run.id)).toHaveLength(1);
		await session(run.id);
		expect(fakes.sendPrompt).toHaveBeenCalledWith(
			expect.objectContaining({ prompt: expect.stringContaining('"automations:run-changed"') }),
		);

		automations.dispose();
		db.exec(`UPDATE event_log SET handled_at = NULL WHERE channel = '${APP_UPDATED_CHANNEL}'`);
		context = harness(db);
		automations = registerAutomations(context, { log: () => {} });
		automations.start();
		await vi.waitFor(() =>
			expect(all(db, 'SELECT id FROM event_log WHERE handled_at IS NULL')).toEqual([]),
		);
		const runs = await context.commands.call('automations.list-runs', undefined);
		expect(runs.filter((entry) => entry.definitionId === definition.id)).toEqual([
			expect.objectContaining({ id: run.id, requests: 1 }),
		]);
	});

	it('tells the review automation to list resolved threads the way shipping reads them', async () => {
		const { instructions } = await builtin('address-review');
		const template = /`(Resolved: <thread id>)`/u.exec(instructions)?.[1];
		if (!template)
			throw new Error('the address-review automation no longer names the resolved format');
		const prompt = `${instructions}\n\nREMOTE_RECORD {"kind":"review_thread","id":"PRRT_kw1"}`;
		const reply = `Renamed the helper as the bot asked.\n${template.replace('<thread id>', 'PRRT_kw1')}`;

		expect(addressedReviewThreadIds(prompt, reply)).toEqual(['PRRT_kw1']);
	});

	it('saves custom automations, keeps where a built-in runs, and resets it', async () => {
		const custom = await saveDefinition({
			name: '  Write changelog  ',
			runsIn: 'new-workstream',
		});
		expect(custom).toMatchObject({
			name: 'Write changelog',
			runsIn: 'new-workstream',
			builtin: null,
			trigger: null,
			thenAutomationId: null,
		});

		const fixChecks = await builtin('fix-checks');
		const edited = await saveDefinition({
			id: fixChecks.id,
			name: 'Fix CI',
			effort: 'max',
			runsIn: 'new-workstream',
			trigger: null,
			thenAutomationId: null,
		});
		expect(edited).toMatchObject({
			name: 'Fix CI',
			effort: 'max',
			runsIn: 'workstream',
			builtin: 'fix-checks',
		});

		const reset = await context.commands.call('automations.reset-definition', {
			definitionId: fixChecks.id,
		});
		expect(reset).toMatchObject({
			name: 'Fix checks',
			effort: 'high',
			instructions: fixChecks.instructions,
		});

		expect(
			await failure('automations.delete-definition', { definitionId: fixChecks.id }),
		).toMatchObject({
			kind: 'builtin',
		});
		expect(
			await failure('automations.reset-definition', { definitionId: custom.id }),
		).toMatchObject({
			kind: 'not-builtin',
		});
		await context.commands.call('automations.delete-definition', { definitionId: custom.id });
		const remaining = await context.commands.call('automations.list-definitions', undefined);
		expect(remaining.map((definition) => definition.id)).not.toContain(custom.id);
		expect(definitionEvents).toContainEqual({ definitionId: custom.id, definition: null });
	});

	it('keeps what a built-in automation without an agent does, and lets it take a trigger and a Then', async () => {
		const openDraft = await builtin('open-draft');
		const merge = await builtin('merge');
		const trigger: AutomationTrigger = {
			when: 'on automations:run-changed where run.status is succeeded',
			mode: 'ask',
		};

		const edited = await saveDefinition({
			id: openDraft.id,
			name: 'Draft PR',
			instructions: 'Do something else entirely.',
			provider: 'claude',
			model: 'haiku',
			effort: 'max',
			skills: ['adr'],
			trigger,
			thenAutomationId: merge.id,
		});

		expect(edited).toEqual({
			...openDraft,
			name: 'Draft PR',
			trigger,
			thenAutomationId: merge.id,
			updatedAt: edited.updatedAt,
		});
	});

	it('lets Update from main take a trigger but no Then, since Resolve conflicts takes its conflicts on its own trigger', async () => {
		const updater = await builtin('update-from-main');
		const resolver = await builtin('resolve-conflicts');
		const trigger: AutomationTrigger = {
			when: 'on repositories:workstream-base-overlapped where conflicts is true',
			mode: 'ask',
		};

		const fields = {
			id: updater.id,
			name: updater.name,
			instructions: updater.instructions,
			provider: 'claude',
			model: updater.model,
			effort: updater.effort,
		};

		expect(await saveDefinition({ ...fields, trigger })).toMatchObject({
			trigger,
			thenAutomationId: null,
		});
		expect(
			await failure('automations.save-definition', {
				...fields,
				runsIn: 'workstream',
				thenAutomationId: resolver.id,
			}),
		).toMatchObject({
			kind: 'builtin',
			message:
				'Update from main takes no Then: when its merge stops on conflicts, Resolve conflicts takes them on its own trigger.',
		});
	});

	it('refuses to delete an automation that is still queued or running', async () => {
		const custom = await saveDefinition();
		openRuns.add('ws-a');
		await context.commands.call('automations.run', {
			definitionId: custom.id,
			workstreamId: 'ws-a',
		});

		expect(
			await failure('automations.delete-definition', { definitionId: custom.id }),
		).toMatchObject({
			kind: 'busy',
		});
	});

	it('rejects invalid definitions and run requests from the renderer', async () => {
		const valid = {
			name: 'Automation',
			instructions: 'Do it.',
			provider: 'claude',
			model: 'opus',
			effort: 'low',
			runsIn: 'workstream',
		};
		const fixChecks = await builtin('fix-checks');
		const nameChats = await builtin('name-chats');
		const fresh = await saveDefinition({ runsIn: 'new-workstream' });
		const when = (text: unknown) => ({ ...valid, trigger: { when: text, mode: 'auto' } });
		const cases: ReadonlyArray<readonly [string, unknown, string]> = [
			['automations.run', { definitionId: nameChats.id, workstreamId: 'ws-a' }, 'builtin'],
			[
				'automations.run',
				{ definitionId: fixChecks.id, workstreamId: 'ws-a', chatSessionId: '' },
				'invalid-args',
			],
			['automations.save-definition', { ...valid, name: '   ' }, 'invalid-args'],
			['automations.save-definition', { ...valid, name: 'x'.repeat(81) }, 'invalid-args'],
			['automations.save-definition', { ...valid, instructions: '' }, 'invalid-args'],
			[
				'automations.save-definition',
				{ ...valid, instructions: 'x'.repeat(20_001) },
				'invalid-args',
			],
			['automations.save-definition', { ...valid, model: 'Not A Model!' }, 'invalid-args'],
			['automations.save-definition', { ...valid, effort: 'extreme' }, 'invalid-args'],
			['automations.save-definition', { ...valid, runsIn: 'nowhere' }, 'invalid-args'],
			['automations.save-definition', when('whenever'), 'invalid-args'],
			['automations.save-definition', when('when a new workstream is created'), 'invalid-args'],
			['automations.save-definition', when('on automations:nothing-changed'), 'invalid-args'],
			['automations.save-definition', when(42), 'invalid-args'],
			['automations.save-definition', { ...valid, trigger: 'on app:updated' }, 'invalid-args'],
			[
				'automations.save-definition',
				{ ...valid, trigger: { when: 'on app:updated', mode: 'sometimes' } },
				'invalid-args',
			],
			['automations.save-definition', { ...valid, thenAutomationId: 'missing' }, 'not-found'],
			['automations.save-definition', { ...valid, thenAutomationId: nameChats.id }, 'builtin'],
			['automations.save-definition', { ...valid, thenAutomationId: '' }, 'invalid-args'],
			[
				'automations.save-definition',
				{ ...valid, id: fixChecks.id, trigger: { when: 'on app:updated', mode: 'auto' } },
				'builtin',
			],
			[
				'automations.save-definition',
				{ ...valid, id: fixChecks.id, thenAutomationId: fresh.id },
				'builtin',
			],
			[
				'automations.save-definition',
				{ ...valid, id: fresh.id, thenAutomationId: fresh.id },
				'invalid-args',
			],
			['automations.save-definition', { ...valid, id: 'missing' }, 'not-found'],
			['automations.run', { definitionId: 'missing', workstreamId: 'ws-a' }, 'not-found'],
			['automations.run', { definitionId: fixChecks.id }, 'invalid-args'],
			['automations.run', { definitionId: fixChecks.id, workstreamId: 'ws-gone' }, 'not-found'],
			['automations.run', { definitionId: fresh.id }, 'invalid-args'],
			['automations.run', { definitionId: fresh.id, repositoryId: 'repo-gone' }, 'not-found'],
			[
				'automations.run',
				{ definitionId: fixChecks.id, workstreamId: 'ws-a', context: 'x'.repeat(64 * 1024 + 1) },
				'invalid-args',
			],
			[
				'automations.run',
				{ definitionId: fixChecks.id, workstreamId: 'ws-a', origin: 'routine' },
				'invalid-args',
			],
			[
				'automations.run',
				{ definitionId: fixChecks.id, workstreamId: 'ws-a', waitForYou: 'yes' },
				'invalid-args',
			],
			[
				'automations.run',
				{ definitionId: fixChecks.id, workstreamId: 'ws-a', parentRunId: 'missing' },
				'not-found',
			],
			['automations.run', { definitionId: fresh.id, origin: 'then' }, 'invalid-args'],
			['automations.cancel-run', { automationRunId: 'missing' }, 'not-found'],
			['automations.confirm-run', { automationRunId: 'missing' }, 'not-found'],
			['automations.accept-suggestion', { suggestionId: 'missing' }, 'not-found'],
			['automations.dismiss-suggestion', {}, 'invalid-args'],
		];

		for (const [command, args, kind] of cases) {
			expect(
				await failure(command, args),
				`${command} ${JSON.stringify(args).slice(0, 80)}`,
			).toMatchObject({ kind });
		}
		expect(await context.commands.call('automations.list-runs', undefined)).toEqual([]);
	});

	it("keeps the chat an automation was run from, for that chat's composer tray", async () => {
		const fixChecks = await builtin('fix-checks');
		const fromChat = await context.commands.call('automations.run', {
			definitionId: fixChecks.id,
			workstreamId: 'ws-a',
			chatSessionId: 'chat-1',
			chatAfterRunId: 'agent-run-9',
		});
		const elsewhere = await context.commands.call('automations.run', {
			definitionId: fixChecks.id,
			workstreamId: 'ws-b',
		});

		expect(fromChat).toMatchObject({ chatSessionId: 'chat-1', chatAfterRunId: 'agent-run-9' });
		expect(elsewhere).toMatchObject({ chatSessionId: null, chatAfterRunId: null });
		expect(await context.commands.call('automations.list-runs', undefined)).toContainEqual(
			expect.objectContaining({ id: fromChat.id, chatSessionId: 'chat-1' }),
		);
	});
});

describe('scheduling', () => {
	it('runs automations first in first out, one per workstream, within the global cap', async () => {
		settings[AUTOMATIONS_MAX_CONCURRENT_SETTING] = '2';
		const first = await runFixChecks('ws-a');
		const second = await runFixChecks('ws-a');
		const third = await runFixChecks('ws-b');
		const fourth = await runFixChecks('ws-c');

		const firstSession = await session(first.id);
		await until(third.id, 'running');
		await settle();
		expect((await automationRun(second.id)).status).toBe('queued');
		expect((await automationRun(fourth.id)).status).toBe('queued');
		const { instructions } = await builtin('fix-checks');
		expect(fakes.startSession).toHaveBeenCalledWith({
			workstreamId: 'ws-a',
			provider: 'claude',
			model: 'opus',
			origin: 'automation',
			displayName: 'Fix checks',
		});
		expect(fakes.sendPrompt).toHaveBeenCalledWith({
			sessionId: firstSession,
			prompt: instructions,
			profile: { effort: 'high', mode: 'agent', access: 'auto' },
			automated: true,
			chainId: first.chainId,
		});

		agentEvent(firstSession, 'agent-run-1', { type: 'run.completed', summary: 'Fixed the lint.' });

		expect(await until(first.id, 'succeeded')).toMatchObject({ detail: 'Fixed the lint.' });
		await until(second.id, 'running');
		await settle();
		expect((await automationRun(fourth.id)).status).toBe('queued');
	});

	it('says once that a run started and once that it finished, however often it changes', async () => {
		const facts: string[] = [];
		context.events.subscribe(AUTOMATIONS_RUN_STARTED_CHANNEL, ({ run }) =>
			facts.push(`${run.id} started`),
		);
		context.events.subscribe(AUTOMATIONS_RUN_FINISHED_CHANNEL, ({ run }) =>
			facts.push(`${run.id} ${run.status}`),
		);
		const queued = await runFixChecks('ws-a');
		const automationSession = await session(queued.id);
		agentEvent(automationSession, 'agent-run-1', {
			type: 'run.completed',
			summary: 'Fixed the lint.',
		});
		await until(queued.id, 'succeeded');
		const waiting = await runOf(await saveDefinition(), { waitForYou: true });
		await context.commands.call('automations.cancel-run', { automationRunId: waiting.id });
		await settle();

		expect(facts).toEqual([
			`${queued.id} started`,
			`${queued.id} succeeded`,
			`${waiting.id} cancelled`,
		]);
	});

	it('finishes an automation whose turn ends with only a background command left running', async () => {
		const queued = await runFixChecks('ws-a');
		const automationSession = await session(queued.id);
		const server = { taskId: 'b-dev', kind: 'command', description: 'Dev server', startedAt: 1 };

		agentEvent(automationSession, 'agent-run-1', {
			type: 'background.updated',
			waiting: false,
			tasks: [server],
		});
		await settle();
		expect((await automationRun(queued.id)).status).toBe('running');

		agentEvent(automationSession, 'agent-run-1', {
			type: 'background.updated',
			waiting: true,
			tasks: [server],
			summary: 'Fixed the lint; the dev server stays up.',
		});

		expect(await until(queued.id, 'succeeded')).toMatchObject({
			detail: 'Fixed the lint; the dev server stays up.',
		});
	});

	it('appends the run context to the instructions', async () => {
		const definition = await builtin('fix-checks');
		const queued = await context.commands.call('automations.run', {
			definitionId: definition.id,
			workstreamId: 'ws-a',
			context: 'Failing: lint',
			origin: 'merge-queue',
		});
		expect(queued).toMatchObject({ origin: 'merge-queue', title: 'Fix checks' });

		await session(queued.id);
		expect(fakes.sendPrompt.mock.calls[0]?.[0]).toMatchObject({
			prompt: `${definition.instructions}\n\nFailing: lint`,
		});
	});

	it('runs an automation with its skills, and with every skill when it has none', async () => {
		const copyPass = await saveDefinition({
			name: 'Copy pass',
			skills: [' humanizer ', 'humanizer', 'adr'],
		});
		const plainDefinition = await saveDefinition({ name: 'Plain pass' });
		expect(copyPass.skills).toEqual(['humanizer', 'adr']);
		expect(plainDefinition.skills).toEqual([]);
		const renamed = await saveDefinition({ id: copyPass.id, name: 'Copy edit' });
		expect(renamed.skills).toEqual(['humanizer', 'adr']);
		await expect(saveDefinition({ name: 'Bad', skills: [''] })).rejects.toThrow(/skills/u);

		const withSkills = await context.commands.call('automations.run', {
			definitionId: copyPass.id,
			workstreamId: 'ws-a',
		});
		const withSkillsSession = await session(withSkills.id);
		await until(withSkills.id, 'running');
		const plain = await context.commands.call('automations.run', {
			definitionId: plainDefinition.id,
			workstreamId: 'ws-b',
		});
		const plainSession = await session(plain.id);

		expect(skillsForRun(db, withSkillsSession)).toEqual(['humanizer', 'adr']);
		expect(skillsForRun(db, plainSession)).toBeNull();
	});

	it("waits for the user's own run in that workstream to end", async () => {
		openRuns.add('ws-a');
		const queued = await runFixChecks('ws-a');
		await settle();
		expect((await automationRun(queued.id)).status).toBe('queued');

		openRuns.delete('ws-a');
		agentEvent('user-session', 'user-run', { type: 'run.completed', summary: 'Done.' });

		await until(queued.id, 'running');
	});

	it('counts an automation waiting for you toward its workstream only', async () => {
		settings[AUTOMATIONS_MAX_CONCURRENT_SETTING] = '1';
		const waiting = await runFixChecks('ws-a');
		const waitingSession = await session(waiting.id);
		const sameWorkstream = await runFixChecks('ws-a');
		const otherWorkstream = await runFixChecks('ws-b');
		await settle();
		expect((await automationRun(otherWorkstream.id)).status).toBe('queued');

		agentEvent(waitingSession, 'agent-run-1', {
			type: 'approval.requested',
			sessionId: waitingSession,
			approvalId: 'approval-1',
			reason: 'Run pnpm test?',
		});

		await until(waiting.id, 'needs-you');
		await until(otherWorkstream.id, 'running');
		expect((await automationRun(sameWorkstream.id)).status).toBe('queued');

		await context.commands.handle({
			command: 'chat.decide-approval',
			args: {
				sessionId: waitingSession,
				runId: 'agent-run-1',
				approvalId: 'approval-1',
				decision: 'allow',
				scope: 'once',
			},
		});
		await until(waiting.id, 'running');
	});

	it('retries an automation while the workstream is still wrapping up its last run', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		fakes.sendPrompt.mockImplementationOnce(() => {
			throw new Error('`ws-a` already has an active run');
		});
		const queued = await runFixChecks('ws-a');
		await vi.waitFor(() => expect(fakes.sendPrompt).toHaveBeenCalledTimes(1));
		const requeued = await until(queued.id, 'queued');
		expect(requeued.sessionId).toBe('session-1');

		agentEvent('user-session', 'user-run', { type: 'run.completed', summary: '' });
		await settle();
		expect(fakes.sendPrompt).toHaveBeenCalledTimes(1);

		vi.setSystemTime(Date.now() + BUSY_RETRY_MS + 1);
		agentEvent('user-session', 'user-run', { type: 'run.completed', summary: '' });

		await session(queued.id);
		expect(fakes.startSession).toHaveBeenCalledTimes(1);
		expect(fakes.sendPrompt).toHaveBeenCalledTimes(2);
	});

	it('fails the automation with a readable reason when it cannot start', async () => {
		fakes.startSession.mockImplementationOnce(() => {
			throw new Error('bridge unavailable: the agent bridge exited');
		});
		const queued = await runFixChecks('ws-a');

		expect(await until(queued.id, 'failed')).toMatchObject({
			detail: 'Could not start the automation: bridge unavailable: the agent bridge exited',
		});
	});

	it('creates a fresh workstream for an automation that runs in a new one', async () => {
		upsertProject(db, {
			id: 'local__acme__app',
			name: 'acme__app',
			repoPath: '/tmp/acme-app',
			defaultBranch: 'main',
			createdAt: NOW,
		});
		upsertConnectedRepository(db, {
			id: 'repo-1',
			fullName: 'acme/app',
			defaultBranch: 'trunk',
			localPath: null,
			remoteUrl: 'https://github.com/acme/app.git',
			createdAt: NOW,
		});
		const definition = await saveDefinition({ runsIn: 'new-workstream' });
		const queued = await context.commands.call('automations.run', {
			definitionId: definition.id,
			repositoryId: 'repo-1',
		});

		await session(queued.id);
		const created = fakes.createWorkstream.mock.calls[0]?.[0];
		expect(created).toMatchObject({
			projectRepoPath: '/tmp/acme-app',
			projectId: 'local__acme__app',
			baseBranch: 'trunk',
		});
		const workstreamId = Reflect.get(Object(created), 'workstreamId');
		expect((await automationRun(queued.id)).workstreamId).toBe(workstreamId);
		expect(fakes.syncBase).toHaveBeenCalledWith({ workstreamId });
		expect(fakes.provision).toHaveBeenCalledWith({ workstreamId });
		expect(fakes.startSession).toHaveBeenCalledWith(
			expect.objectContaining({ workstreamId, displayName: 'Write changelog' }),
		);
	});

	it('starts a new-workstream automation from a trigger in the repository of its workstream', async () => {
		upsertProject(db, {
			id: 'local__acme__app',
			name: 'acme__app',
			repoPath: '/tmp/acme-app',
			defaultBranch: 'main',
			createdAt: NOW,
		});
		upsertConnectedRepository(db, {
			id: 'repo-1',
			fullName: 'acme/app',
			defaultBranch: 'main',
			localPath: null,
			remoteUrl: 'https://github.com/acme/app.git',
			createdAt: NOW,
		});
		upsertWorkstream(db, {
			id: 'ws-acme',
			projectId: 'local__acme__app',
			name: 'ws-acme',
			path: '/tmp/ws-acme',
			branch: 'malini/ws-acme',
			baseBranch: 'main',
			status: 'active',
			createdAt: NOW,
			scope: null,
			startedBy: null,
		});
		const definition = await saveDefinition({ runsIn: 'new-workstream' });
		const queued = await context.commands.call('automations.run', {
			definitionId: definition.id,
			workstreamId: 'ws-acme',
			origin: 'trigger',
		});

		expect(queued).toMatchObject({ workstreamId: null, repositoryId: 'local__acme__app' });
		await session(queued.id);
		expect(fakes.createWorkstream.mock.calls[0]?.[0]).toMatchObject({
			projectRepoPath: '/tmp/acme-app',
			projectId: 'local__acme__app',
		});
	});
});

describe('update from main', () => {
	async function runUpdate(automationContext?: string): Promise<AutomationRunRecord> {
		const definition = await builtin('update-from-main');
		return context.commands.call('automations.run', {
			definitionId: definition.id,
			workstreamId: 'ws-a',
			...(automationContext === undefined ? {} : { context: automationContext }),
		});
	}

	const conflictContext = updateFromMainAutomationContext({
		branch: 'malini/ws-a',
		baseBranch: 'main',
		conflictedPaths: ['src/shared.ts'],
		conflictMarkerPaths: ['src/shared.ts'],
	});

	it('merges a clean base branch itself and finishes without an agent', async () => {
		fakes.countBehind.mockReturnValueOnce(3);
		const queued = await runUpdate();

		expect(await until(queued.id, 'succeeded')).toMatchObject({
			detail: 'Merged 3 commits from main',
		});
		expect(fakes.countBehind).toHaveBeenCalledWith({ workstreamId: 'ws-a', baseBranch: 'main' });
		expect(fakes.pull).toHaveBeenCalledWith({ workstreamId: 'ws-a', baseBranch: 'main' });
		expect(fakes.startSession).not.toHaveBeenCalled();
	});

	it('finishes at once when the workstream already has every base commit', async () => {
		const queued = await runUpdate();

		expect(await until(queued.id, 'succeeded')).toMatchObject({
			detail: 'Already up to date with main',
		});
		expect(fakes.pull).not.toHaveBeenCalled();
		expect(fakes.startSession).not.toHaveBeenCalled();
	});

	it('stops on the conflicts its merge hits, and Resolve conflicts takes them on its own trigger', async () => {
		const resolver = await builtin('resolve-conflicts');
		fakes.countBehind.mockReturnValueOnce(1);
		fakes.workstreamStatus
			.mockReturnValueOnce(worktree())
			.mockReturnValueOnce(conflictedMerge())
			.mockReturnValueOnce(conflictedMerge());
		fakes.pull.mockImplementationOnce(() => {
			context.events.emit('repositories:workstream-merge-conflicted', {
				workstreamId: 'ws-a',
				baseBranch: 'main',
				conflictedPaths: ['src/shared.ts'],
			});
			return 'abc1234';
		});
		const queued = await runUpdate('Pull request: #7');

		expect(await until(queued.id, 'succeeded')).toMatchObject({
			detail: 'Stopped on conflicts in 1 file.',
		});
		expect(fakes.pull).toHaveBeenCalledTimes(1);
		const resolving = await vi.waitFor(async () => {
			const runs = await context.commands.call('automations.list-runs', undefined);
			const found = runs.find((run) => run.definitionId === resolver.id);
			if (!found) throw new Error('no Resolve conflicts run yet');
			return found;
		});
		expect(resolving).toMatchObject({ workstreamId: 'ws-a', origin: 'trigger', parentRunId: null });
		const conflict = get<{ id: number; cause_kind: string; cause_id: string }>(
			db,
			"SELECT id, cause_kind, cause_id FROM event_log WHERE channel = 'repositories:workstream-merge-conflicted'",
		);
		expect(conflict).toMatchObject({ cause_kind: 'automation-run', cause_id: queued.id });
		expect(automationRunEventIds(db, [resolving.id]).get(resolving.id)).toEqual([conflict?.id]);
		expect(resolving.chainId).toBe(queued.chainId);
		await session(resolving.id);
		expect(fakes.startSession).toHaveBeenCalledWith(
			expect.objectContaining({ displayName: 'Resolve conflicts' }),
		);
		expect(fakes.sendPrompt.mock.calls[0]?.[0]).toMatchObject({
			prompt: expect.stringContaining(resolver.instructions),
		});
		expect(fakes.sendPrompt.mock.calls[0]?.[0]).toMatchObject({
			prompt: expect.stringContaining(conflictContext),
		});
	});

	it('leaves a merge already stopped on conflicts to Resolve conflicts, starting nothing itself', async () => {
		const resolver = await builtin('resolve-conflicts');
		fakes.workstreamStatus.mockReturnValueOnce(conflictedMerge());
		const queued = await runUpdate();

		expect(await until(queued.id, 'succeeded')).toMatchObject({
			detail: 'A merge had already stopped on conflicts in 1 file.',
		});
		expect(fakes.countBehind).not.toHaveBeenCalled();
		expect(fakes.pull).not.toHaveBeenCalled();
		const runs = await context.commands.call('automations.list-runs', undefined);
		expect(runs.find((run) => run.definitionId === resolver.id)).toBeUndefined();
	});

	it.each([
		[
			'uncommitted changes',
			worktree({ dirtyPaths: ['notes.md'] }),
			'Commit or discard the uncommitted changes, then update from main again.',
		],
		[
			'a stopped rebase',
			worktree({ mergeInProgress: true, operationInProgress: 'rebase' }),
			'A rebase is in progress in this workstream. Finish or abort it first.',
		],
	])('refuses to merge over %s', async (_label, status, detail) => {
		fakes.workstreamStatus.mockReturnValueOnce(status);
		const queued = await runUpdate();

		expect(await until(queued.id, 'failed')).toMatchObject({ detail });
		expect(fakes.countBehind).not.toHaveBeenCalled();
		expect(fakes.pull).not.toHaveBeenCalled();
		expect(fakes.startSession).not.toHaveBeenCalled();
	});

	it('neither merges nor starts the agent once cancelled mid-update', async () => {
		let behind: (count: number) => void = () => {};
		fakes.countBehind.mockImplementationOnce(
			() => new Promise<number>((resolve) => (behind = resolve)),
		);
		const queued = await runUpdate();
		await vi.waitFor(() => expect(fakes.countBehind).toHaveBeenCalled());

		await context.commands.call('automations.cancel-run', { automationRunId: queued.id });
		behind(2);
		await settle();

		expect((await automationRun(queued.id)).status).toBe('cancelled');
		expect(fakes.pull).not.toHaveBeenCalled();
		expect(fakes.startSession).not.toHaveBeenCalled();
	});
});

describe('tracking', () => {
	it('follows the agent run through a question to failure', async () => {
		const queued = await runFixChecks('ws-a');
		const sessionId = await session(queued.id);

		agentEvent(sessionId, 'agent-run-1', {
			type: 'question.requested',
			sessionId,
			questionId: 'question-1',
			questions: [],
		});
		await until(queued.id, 'needs-you');

		await context.commands.handle({
			command: 'chat.answer-question',
			args: { sessionId, runId: 'agent-run-1', questionId: 'question-1', answers: [] },
		});
		await until(queued.id, 'running');

		agentEvent(sessionId, 'agent-run-1', { type: 'run.failed', error: PAUSED_FOR_EXIT_ERROR });
		await settle();
		expect((await automationRun(queued.id)).status).toBe('running');

		agentEvent(sessionId, 'agent-run-1', { type: 'run.failed', error: 'tests still fail' });
		expect(await until(queued.id, 'failed')).toMatchObject({ detail: 'tests still fail' });
	});

	it('keeps an automation running while a limit pauses its turn, and finishes it with the turn that goes on', async () => {
		const queued = await runFixChecks('ws-a');
		const sessionId = await session(queued.id);

		agentEvent(sessionId, 'agent-run-1', {
			type: 'run.failed',
			error: "You've hit your session limit",
			failure: { kind: 'usage-limit', resetsAt: '2026-10-27T14:31:13.000Z' },
			resumeAt: '2026-10-27T14:31:18.000Z',
		});
		await settle();
		expect((await automationRun(queued.id)).status).toBe('running');

		agentEvent(sessionId, 'agent-run-2', { type: 'run.started', sessionId });
		agentEvent(sessionId, 'agent-run-2', {
			type: 'run.completed',
			summary: 'Fixed after the reset.',
		});
		expect(await until(queued.id, 'succeeded')).toMatchObject({
			detail: 'Fixed after the reset.',
			agentRunId: 'agent-run-2',
		});
	});

	it('marks the automation cancelled when its agent run is cancelled', async () => {
		const queued = await runFixChecks('ws-a');
		const sessionId = await session(queued.id);

		agentEvent(sessionId, 'agent-run-1', { type: 'run.failed', error: 'cancelled' });

		await until(queued.id, 'cancelled');
	});

	it('cancels queued automations without starting them and stops running ones', async () => {
		settings[AUTOMATIONS_MAX_CONCURRENT_SETTING] = '1';
		const running = await runFixChecks('ws-a');
		const sessionId = await session(running.id);
		const queued = await runFixChecks('ws-b');

		expect(
			await context.commands.call('automations.cancel-run', { automationRunId: queued.id }),
		).toMatchObject({
			status: 'cancelled',
		});
		expect(
			await context.commands.call('automations.cancel-run', { automationRunId: running.id }),
		).toMatchObject({
			status: 'cancelled',
		});
		expect(fakes.cancelRun).toHaveBeenCalledWith({ sessionId, pendingRunId: 'agent-run-1' });

		agentEvent(sessionId, 'agent-run-1', { type: 'run.failed', error: 'cancelled' });
		await settle();
		expect(fakes.startSession).toHaveBeenCalledTimes(1);
		expect((await automationRun(running.id)).status).toBe('cancelled');
	});

	it('cancels an automation whose agent has no run to stop yet without logging the race as a failure', async () => {
		automations.dispose();
		const logged: string[] = [];
		context = harness(db);
		automations = registerAutomations(context, { log: (line) => logged.push(line) });
		automations.start();
		fakes.cancelRun.mockImplementationOnce(() => {
			throw new Error('cancel race: no active run for session');
		});
		const running = await runFixChecks('ws-a');
		await session(running.id);

		expect(
			await context.commands.call('automations.cancel-run', { automationRunId: running.id }),
		).toMatchObject({
			status: 'cancelled',
		});
		await settle();
		expect(logged.filter((line) => line.includes('could not stop'))).toEqual([]);
	});
});

describe('restart', () => {
	it('keeps tracking runs malini resumed or a limit paused, and fails the ones it could not', async () => {
		automations.dispose();
		const definition = await builtin('fix-checks');
		const left = (
			id: string,
			workstreamId: string,
			sessionId: string | null,
			status: AutomationRunStatus,
		): AutomationRunRecord => {
			const record: AutomationRunRecord = {
				id,
				definitionId: definition.id,
				title: definition.name,
				workstreamId,
				repositoryId: null,
				scope: null,
				sessionId,
				agentRunId: sessionId === null ? null : `${id}-first-run`,
				origin: 'merge-queue',
				status,
				detail: null,
				parentRunId: null,
				chatSessionId: null,
				chatAfterRunId: null,
				chainId: id,
				requests: 1,
				createdAt: `2026-10-10T00:00:0${id.length}.000Z`,
				startedAt: status === 'queued' ? null : NOW,
				finishedAt: null,
			};
			insertAutomationRun(db, record, null);
			return record;
		};
		left('resumed', 'ws-a', 's-resumed', 'running');
		left('lost', 'ws-b', 's-lost', 'running');
		left('paused', 'ws-c', 's-paused', 'running');
		left('finished', 'ws-c', 's-finished', 'needs-you');
		left('never', 'ws-d', null, 'running');
		left('waiting-for-b', 'ws-b', null, 'queued');
		left('held', 'ws-a', null, 'waiting');
		const envelope = (sessionId: string, runId: string, event: Record<string, unknown>) => {
			seq += 1;
			return { sessionId, runId, seq, event: { runId, ...event } };
		};
		sessionEvents.set('s-resumed', [
			envelope('s-resumed', 'r1', { type: 'run.started' }),
			envelope('s-resumed', 'r1', { type: 'run.failed', error: PAUSED_FOR_EXIT_ERROR }),
			envelope('s-resumed', 'r2', { type: 'user.message', text: 'Continue where you left off.' }),
		]);
		sessionEvents.set('s-lost', [
			envelope('s-lost', 'r3', { type: 'run.started' }),
			envelope('s-lost', 'r3', { type: 'run.failed', error: PAUSED_FOR_EXIT_ERROR }),
		]);
		sessionEvents.set('s-paused', [
			envelope('s-paused', 'r5', { type: 'run.started' }),
			envelope('s-paused', 'r5', {
				type: 'run.failed',
				error: 'API Error: 529 Overloaded',
				failure: { kind: 'overloaded', status: 529 },
				resumeAt: '2026-10-10T00:05:00.000Z',
			}),
		]);
		sessionEvents.set('s-finished', [
			envelope('s-finished', 'r4', { type: 'run.started' }),
			envelope('s-finished', 'r4', { type: 'run.completed', summary: 'All green.' }),
		]);

		context = harness(db);
		automations = registerAutomations(context, { log: () => {} });
		automations.start();

		expect(await until('lost', 'failed')).toMatchObject({
			detail: 'Interrupted when Malini closed',
		});
		expect(await until('never', 'failed')).toMatchObject({
			detail: 'Interrupted when Malini closed',
		});
		expect(await until('finished', 'succeeded')).toMatchObject({ detail: 'All green.' });
		await until('waiting-for-b', 'running');
		expect(await automationRun('resumed')).toMatchObject({ status: 'running', agentRunId: 'r2' });
		expect((await automationRun('held')).status).toBe('waiting');
		expect((await automationRun('paused')).status).toBe('running');

		agentEvent('s-resumed', 'r2', { type: 'run.started', sessionId: 's-resumed' });
		agentEvent('s-resumed', 'r2', { type: 'run.completed', summary: 'Picked up where it left.' });
		await until('resumed', 'succeeded');
	});
});

describe('resolve conflicts', () => {
	const conflictContext = updateFromMainAutomationContext({
		branch: 'malini/ws-a',
		baseBranch: 'main',
		conflictedPaths: ['src/shared.ts'],
		conflictMarkerPaths: ['src/shared.ts'],
	});

	it('finishes without an agent when there is nothing to resolve', async () => {
		const queued = await runOf(await builtin('resolve-conflicts'));

		expect(await until(queued.id, 'succeeded')).toMatchObject({
			detail: 'No conflicts to resolve.',
		});
		expect(fakes.workstreamStatus).toHaveBeenCalledWith({ workstreamId: 'ws-a' });
		expect(fakes.startSession).not.toHaveBeenCalled();
	});

	it('starts the agent on the conflicts, after the context the run carries', async () => {
		const resolver = await builtin('resolve-conflicts');
		fakes.workstreamStatus.mockReturnValueOnce(conflictedMerge());
		const queued = await runOf(resolver, { context: 'Pull request: #7', origin: 'merge-queue' });

		await session(queued.id);
		expect(fakes.sendPrompt.mock.calls[0]?.[0]).toMatchObject({
			prompt: `${resolver.instructions}\n\nPull request: #7\n\n${conflictContext}`,
		});
	});
});

describe('automations without an agent', () => {
	it('opens a draft pull request without starting a chat', async () => {
		fakes.openDraft.mockResolvedValueOnce({
			...shipState(),
			pullRequestNumber: 7,
			pullRequestUrl: 'https://github.com/acme/app/pull/7',
		});
		const queued = await runOf(await builtin('open-draft'));

		expect(await until(queued.id, 'succeeded')).toMatchObject({
			detail: 'Malini pushes to https://github.com/acme/app/pull/7',
		});
		expect(fakes.openDraft).toHaveBeenCalledWith({ workstreamId: 'ws-a' });
		expect(fakes.startSession).not.toHaveBeenCalled();
	});

	it('queues the merge, and fails with what went wrong', async () => {
		const merge = await builtin('merge');
		const queued = await runOf(merge);
		expect(await until(queued.id, 'succeeded')).toMatchObject({
			detail: 'Queued to merge. Malini opens the pull request once the workstream is idle.',
		});
		expect(fakes.queueMerge).toHaveBeenCalledWith({ workstreamId: 'ws-a' });

		fakes.queueMerge.mockRejectedValueOnce(new Error('GitHub said no'));
		const refused = await runOf(merge, { workstreamId: 'ws-b' });
		expect(await until(refused.id, 'failed')).toMatchObject({ detail: 'GitHub said no' });
		expect(fakes.startSession).not.toHaveBeenCalled();
	});
});

describe('then', () => {
	it('saves a Then, refuses one that loops back, and drops it when the next automation is deleted', async () => {
		const first = await saveDefinition({ name: 'First' });
		const second = await saveDefinition({ name: 'Second', thenAutomationId: first.id });
		const third = await saveDefinition({ name: 'Third' });
		const linked = await saveDefinition({
			id: third.id,
			name: 'Third',
			thenAutomationId: second.id,
		});
		expect(linked.thenAutomationId).toBe(second.id);

		expect(
			await failure('automations.save-definition', {
				name: 'First',
				instructions: 'Go.',
				provider: 'claude',
				model: 'opus',
				effort: 'low',
				runsIn: 'workstream',
				id: first.id,
				thenAutomationId: third.id,
			}),
		).toMatchObject({ kind: 'loop' });
		const kept = await saveDefinition({ id: second.id, name: 'Renamed second' });
		expect(kept.thenAutomationId).toBe(first.id);

		definitionEvents = [];
		await context.commands.call('automations.delete-definition', { definitionId: second.id });
		expect(definitionEvents).toEqual([
			{ definitionId: third.id, definition: expect.objectContaining({ thenAutomationId: null }) },
			{ definitionId: second.id, definition: null },
		]);
	});

	it('asks for the next automation in the same workstream with the result, after a success only', async () => {
		const next = await saveDefinition({ name: 'Ship notes', instructions: 'Write the notes.' });
		const first = await saveDefinition({ name: 'Fix it', thenAutomationId: next.id });
		const succeeding = await runOf(first);
		complete(await session(succeeding.id), 'Fixed the bug.');
		await until(succeeding.id, 'succeeded');

		const followUp = await vi.waitFor(async () => {
			const runs = await context.commands.call('automations.list-runs', undefined);
			const found = runs.find((run) => run.definitionId === next.id);
			if (!found) throw new Error('no Then run yet');
			return found;
		});
		expect(followUp).toMatchObject({
			workstreamId: 'ws-a',
			origin: 'then',
			parentRunId: succeeding.id,
		});
		await session(followUp.id);
		expect(fakes.sendPrompt.mock.calls[1]?.[0]).toMatchObject({
			prompt:
				'Write the notes.\n\nThis automation runs after “Fix it”, which finished with:\n\nFixed the bug.',
		});

		const failing = await runOf(first, { workstreamId: 'ws-b' });
		agentEvent(await session(failing.id), 'agent-run-3', {
			type: 'run.failed',
			error: 'tests fail',
		});
		await until(failing.id, 'failed');
		await settle();
		const runs = await context.commands.call('automations.list-runs', undefined);
		expect(runs.filter((run) => run.definitionId === next.id)).toHaveLength(1);
	});

	it('hands an automation its trigger as facts and no report before it, unless you let it see them', async () => {
		const words = 'tangerine-7f3a';
		const trigger: AutomationTrigger = { when: 'on chat:turn-finished', mode: 'auto' };
		const sealed = await saveDefinition({ name: 'Recall', trigger });
		const open = await saveDefinition({
			name: 'Recall all',
			trigger,
			boundary: { ...DEFAULT_AUTOMATION_BOUNDARY, event: 'full' },
		});
		context.events.emit(CHAT_TURN_FINISHED_CHANNEL, {
			workstreamId: 'ws-a',
			sessionId: 'chat-1',
			runId: 'run-1',
			status: 'succeeded',
			outcome: words,
			needs: words,
			backgroundCommands: [words],
		});
		await settle();
		const contextOf = async (definition: AutomationDefinitionRecord): Promise<string> => {
			const runs = await context.commands.call('automations.list-runs', undefined);
			const run = runs.find(({ definitionId }) => definitionId === definition.id);
			return getAutomationRunContext(db, run?.id ?? '') ?? '';
		};
		expect(JSON.parse(await contextOf(sealed))).toEqual({
			event: CHAT_TURN_FINISHED_CHANNEL,
			payload: {
				workstreamId: 'ws-a',
				sessionId: 'chat-1',
				runId: 'run-1',
				status: 'succeeded',
				repositoryId: 'project',
			},
		});
		expect(await contextOf(open)).toContain(words);

		const notes = await saveDefinition({
			name: 'Ship notes',
			instructions: 'Write the notes.',
			boundary: { ...DEFAULT_AUTOMATION_BOUNDARY, before: false },
		});
		const fixing = await runOf(
			await saveDefinition({ name: 'Fix it', thenAutomationId: notes.id }),
			{
				workstreamId: 'ws-b',
			},
		);
		complete(await session(fixing.id), `Fixed it.\n\nOutcome: ${words}`);
		const followUp = await vi.waitFor(async () => {
			const runs = await context.commands.call('automations.list-runs', undefined);
			const found = runs.find(({ definitionId }) => definitionId === notes.id);
			if (!found) throw new Error('no Then run yet');
			return found;
		});
		await session(followUp.id);
		expect(fakes.sendPrompt.mock.calls.at(-1)?.[0]).toMatchObject({
			prompt: 'Write the notes.\n\nThis automation runs after “Fix it”.',
		});
	});

	it('runs a Then in the workstream it follows, even when the automation runs in a new one', async () => {
		const fresh = await saveDefinition({ runsIn: 'new-workstream' });

		expect(await runOf(fresh, { origin: 'then' })).toMatchObject({
			workstreamId: 'ws-a',
			repositoryId: null,
		});
	});

	it('refuses an automation that already ran in its chain, and records why the Then did not start', async () => {
		const next = await saveDefinition({ name: 'Notes' });
		const first = await saveDefinition({ name: 'Fix it', thenAutomationId: next.id });
		openRuns.add('ws-b');
		const earlier = await runOf(next, { workstreamId: 'ws-b' });

		expect(
			await failure('automations.run', {
				definitionId: next.id,
				workstreamId: 'ws-a',
				parentRunId: earlier.id,
			}),
		).toMatchObject({ kind: 'loop' });

		const chained = await runOf(first, { parentRunId: earlier.id });
		complete(await session(chained.id), 'Fixed.');
		await vi.waitFor(async () =>
			expect((await automationRun(chained.id)).detail).toBe(
				'Fixed.\n\nCould not start Notes: Notes already ran earlier in this chain of automations, so it does not run again.',
			),
		);
		expect((await automationRun(chained.id)).status).toBe('succeeded');
	});
});

describe('an automation whose turn ends over background commands', () => {
	const warmUp = {
		taskId: 'b-warm',
		kind: 'command',
		description: 'Wait for the warm-up',
		startedAt: 1,
	};
	const REPORT = 'Appended the line.\n\nOutcome: notes.md has the automation line\nNeeds: nothing';

	function waitOver(automationSession: string, summary: string): void {
		agentEvent(automationSession, 'agent-run-1', {
			type: 'background.updated',
			waiting: true,
			tasks: [warmUp],
			summary,
		});
	}

	function goOn(automationSession: string): void {
		agentEvent(automationSession, 'agent-run-1', {
			type: 'background.updated',
			waiting: false,
			tasks: [],
		});
		agentEvent(automationSession, 'agent-run-1', {
			type: 'tool.started',
			name: 'Bash',
			toolCallId: 'append',
		});
	}

	async function runsOf(definitionId: string): Promise<AutomationRunRecord[]> {
		const runs = await context.commands.call('automations.list-runs', undefined);
		return runs.filter((run) => run.definitionId === definitionId);
	}

	async function thenOf(definitionId: string): Promise<AutomationRunRecord> {
		return vi.waitFor(async () => {
			const [found] = await runsOf(definitionId);
			if (!found) throw new Error('no Then run yet');
			return found;
		});
	}

	async function chained() {
		const next = await saveDefinition({ name: 'Note after', instructions: 'Append then.' });
		const first = await saveDefinition({ name: 'Warm-up note', thenAutomationId: next.id });
		const automation = await runOf(first);
		return { next, automation, automationSession: await session(automation.id) };
	}

	it('finishes at once, runs again when its agent goes on, and finishes with the end of that run', async () => {
		const finished: string[] = [];
		context.events.subscribe(AUTOMATIONS_RUN_FINISHED_CHANNEL, ({ run }) =>
			finished.push(`${run.status}: ${run.detail}`),
		);
		const automation = await runOf(await saveDefinition());
		const automationSession = await session(automation.id);

		waitOver(automationSession, 'Waiting for the warm-up.');
		expect(await until(automation.id, 'succeeded')).toMatchObject({
			detail: 'Waiting for the warm-up.',
		});
		goOn(automationSession);
		expect(await until(automation.id, 'running')).toMatchObject({ detail: null, finishedAt: null });
		complete(automationSession, REPORT);

		expect(await until(automation.id, 'succeeded')).toMatchObject({ detail: REPORT });
		expect(finished).toEqual(['succeeded: Waiting for the warm-up.', `succeeded: ${REPORT}`]);
	});

	it("holds its Then while its agent may go on, then starts it once, with the run's last result", async () => {
		const { next, automation, automationSession } = await chained();

		waitOver(automationSession, 'Waiting for the warm-up.');
		const then = await thenOf(next.id);
		await settle();
		expect((await automationRun(then.id)).status).toBe('queued');
		goOn(automationSession);
		await until(automation.id, 'running');
		complete(automationSession, REPORT);
		await until(automation.id, 'succeeded');

		await session(then.id);
		expect(fakes.sendPrompt.mock.calls[1]?.[0]).toMatchObject({
			prompt: `Append then.\n\nThis automation runs after “Warm-up note”, which finished with:\n\n${REPORT}`,
		});
		expect(await runsOf(next.id)).toHaveLength(1);
	});

	it('starts its Then at once when it ended with its report, and never twice', async () => {
		const { next, automation, automationSession } = await chained();

		waitOver(automationSession, 'Started the preview.\n\nOutcome: The preview serves the docs');
		const then = await thenOf(next.id);
		const thenSession = await session(then.id);
		agentEvent(thenSession, 'agent-run-2', { type: 'run.completed', summary: 'Done.' });
		await until(then.id, 'succeeded');
		goOn(automationSession);
		await until(automation.id, 'running');
		complete(automationSession, REPORT);
		await until(automation.id, 'succeeded');
		await settle();

		expect(await runsOf(next.id)).toHaveLength(1);
	});

	it('starts a held Then once the run ends without its agent going on', async () => {
		const { next, automationSession } = await chained();

		waitOver(automationSession, 'Waiting for the warm-up.');
		const then = await thenOf(next.id);
		await settle();
		expect((await automationRun(then.id)).status).toBe('queued');
		complete(automationSession, 'Waiting for the warm-up.');

		await session(then.id);
		expect(fakes.sendPrompt.mock.calls[1]?.[0]).toMatchObject({
			prompt:
				'Append then.\n\nThis automation runs after “Warm-up note”, which finished with:\n\nWaiting for the warm-up.',
		});
	});

	it('cancels a held Then when the automation goes on and fails', async () => {
		const { next, automation, automationSession } = await chained();

		waitOver(automationSession, 'Waiting for the warm-up.');
		const then = await thenOf(next.id);
		goOn(automationSession);
		agentEvent(automationSession, 'agent-run-1', { type: 'run.failed', error: 'tests fail' });
		await until(automation.id, 'failed');

		expect(await until(then.id, 'cancelled')).toMatchObject({
			detail: 'Warm-up note went on and did not succeed.',
		});
		expect(fakes.startSession).toHaveBeenCalledTimes(1);
	});
});

describe('waiting for you', () => {
	it('never starts a waiting run or lets it hold its workstream, until you confirm it', async () => {
		settings[AUTOMATIONS_MAX_CONCURRENT_SETTING] = '1';
		const automation = await saveDefinition();
		const waiting = await runOf(automation, { waitForYou: true, origin: 'trigger' });
		expect(waiting.status).toBe('waiting');

		const other = await runFixChecks('ws-a');
		const otherSession = await session(other.id);
		expect((await automationRun(waiting.id)).status).toBe('waiting');
		expect(fakes.startSession).toHaveBeenCalledTimes(1);

		expect(
			await context.commands.call('automations.confirm-run', { automationRunId: waiting.id }),
		).toMatchObject({
			status: 'queued',
		});
		await settle();
		expect((await automationRun(waiting.id)).status).toBe('queued');

		complete(otherSession, 'Done.');
		await until(waiting.id, 'running');
		expect(
			await context.commands.call('automations.confirm-run', { automationRunId: waiting.id }),
		).toMatchObject({
			status: 'running',
		});
	});

	it('skips a waiting run without starting it', async () => {
		const waiting = await runOf(await saveDefinition(), { waitForYou: true });

		expect(
			await context.commands.call('automations.cancel-run', { automationRunId: waiting.id }),
		).toMatchObject({
			status: 'cancelled',
		});
		await settle();
		expect(fakes.startSession).not.toHaveBeenCalled();
		expect(fakes.cancelRun).not.toHaveBeenCalled();
	});

	it('skips the waiting runs of an automation whose trigger is switched off or changed', async () => {
		const trigger: AutomationTrigger = { when: 'on pull-requests:ship-changed', mode: 'ask' };
		const automation = await saveDefinition({ trigger });
		const first = await runOf(automation, { waitForYou: true });

		await saveDefinition({ id: automation.id, trigger: { ...trigger, mode: 'auto' } });
		expect((await automationRun(first.id)).status).toBe('waiting');
		await saveDefinition({ id: automation.id, trigger: { ...trigger, mode: 'off' } });
		expect((await automationRun(first.id)).status).toBe('cancelled');

		await saveDefinition({ id: automation.id, trigger });
		const second = await runOf(automation, { waitForYou: true });
		await saveDefinition({ id: automation.id, trigger: { ...trigger, when: 'on app:updated' } });
		expect((await automationRun(second.id)).status).toBe('cancelled');
	});

	it('deletes an automation that only has runs waiting for you', async () => {
		const automation = await saveDefinition();
		const waiting = await runOf(automation, { waitForYou: true });
		const changes: AutomationRunRecord[] = [];
		context.events.subscribe(AUTOMATIONS_RUN_CHANGED_CHANNEL, ({ run }) => changes.push(run));

		await context.commands.call('automations.delete-definition', { definitionId: automation.id });

		expect(changes).toEqual([expect.objectContaining({ id: waiting.id, status: 'cancelled' })]);
		expect(getAutomationRun(db, waiting.id)).toBeNull();
	});
});

describe('suggestions after merges', () => {
	const changelogHabit = {
		same: [1],
		name: 'Changelog entry',
		instructions:
			'Check the changelog has an entry for the pull request that merged. Say so if not.',
	};

	function merge(workstreamId: string, pullRequestNumber: number, emittedAt: string): void {
		insertLoggedEvent(db, {
			channel: 'pull-requests:ship-changed',
			payload: JSON.stringify({
				workstreamId,
				state: null,
				merged: {
					pullRequestNumber,
					pullRequestUrl: `https://github.com/o/r/pull/${pullRequestNumber}`,
				},
			}),
			workstreamId,
			cause: null,
			chainId: `merge-${pullRequestNumber}`,
			emittedAt,
		});
	}

	function ask(workstreamId: string, runId: string, prompt: string, startedAt: string): void {
		const sessionId = `chat-${workstreamId}`;
		if (!get(db, 'SELECT 1 AS found FROM agent_sessions WHERE id = ?', sessionId)) {
			insertSession(db, {
				id: sessionId,
				workstreamId,
				provider: 'claude',
				model: null,
				providerSessionId: null,
				status: 'idle',
				startedAt,
			});
		}
		insertRun(db, {
			id: runId,
			sessionId,
			prompt,
			startedAt,
			completedAt: null,
			summary: null,
			error: null,
		});
		context.events.emit(CHAT_TURN_FINISHED_CHANNEL, {
			workstreamId,
			sessionId,
			runId,
			status: 'succeeded',
			outcome: null,
			needs: null,
			backgroundCommands: null,
		});
	}

	async function suggestedAfterTwoMerges(): Promise<AutomationSuggestionRecord> {
		answers.mockResolvedValue(changelogHabit);
		merge('ws-a', 73, '2026-10-11T10:00:00.000Z');
		ask('ws-a', 'run-73', 'Is the changelog published?', '2026-10-11T10:55:00.000Z');
		merge('ws-b', 75, '2026-10-12T09:00:00.000Z');
		ask('ws-b', 'run-75', 'Did the changelog get an entry?', '2026-10-12T09:20:00.000Z');
		await vi.waitFor(() => expect(suggested).toHaveLength(1));
		const [suggestion] = suggested;
		if (!suggestion) throw new Error('no suggestion');
		return suggestion;
	}

	it('suggests an automation once the first ask after a merge repeats after another merge', async () => {
		const suggestion = await suggestedAfterTwoMerges();

		expect(answers).toHaveBeenCalledTimes(1);
		expect(answers.mock.calls[0]?.[0]).toBe(
			[
				'Earlier asks:',
				'1. after #73 merged, <ask>Is the changelog published?</ask>',
				'',
				'Latest ask: after #75 merged, <ask>Did the changelog get an entry?</ask>',
			].join('\n'),
		);
		expect(suggestion).toMatchObject({
			repositoryId: 'project',
			sessionId: 'chat-ws-b',
			afterRunId: 'run-75',
			name: 'Changelog entry',
			instructions: changelogHabit.instructions,
			when: 'on pull-requests:ship-changed where merged is set and repositoryId is project',
			status: 'open',
			definitionId: null,
			asks: [
				{
					text: 'Is the changelog published?',
					workstreamId: 'ws-a',
					pullRequestNumber: 73,
					askedAt: '2026-10-11T10:55:00.000Z',
				},
				{
					text: 'Did the changelog get an entry?',
					workstreamId: 'ws-b',
					pullRequestNumber: 75,
					askedAt: '2026-10-12T09:20:00.000Z',
				},
			],
		});
		expect(await context.commands.call('automations.list-suggestions', undefined)).toEqual([
			suggestion,
		]);
	});

	it('counts only the first typed ask in the day after a merge', async () => {
		merge('ws-a', 73, '2026-10-11T10:00:00.000Z');
		ask('ws-a', 'first', 'Is the changelog published?', '2026-10-11T10:55:00.000Z');
		ask('ws-a', 'second', 'Is the changelog published?', '2026-10-11T11:00:00.000Z');
		ask('ws-b', 'no-merge', 'Is the changelog published?', '2026-10-11T11:05:00.000Z');
		merge('ws-c', 74, '2026-10-01T10:00:00.000Z');
		ask('ws-c', 'too-late', 'Is the changelog published?', '2026-10-11T11:10:00.000Z');
		await settle();

		expect(answers).not.toHaveBeenCalled();
		expect(all(db, 'SELECT run_id FROM automation_asks')).toEqual([{ run_id: 'first' }]);
	});

	it('saves an automation that asks first after the next merge in the repository', async () => {
		const suggestion = await suggestedAfterTwoMerges();

		const { suggestion: accepted, automation } = await context.commands.call(
			'automations.accept-suggestion',
			{ suggestionId: suggestion.id },
		);

		expect(automation).toMatchObject({
			name: 'Changelog entry',
			instructions: changelogHabit.instructions,
			runsIn: 'new-workstream',
			builtin: null,
			trigger: {
				when: 'on pull-requests:ship-changed where merged is set and repositoryId is project',
				mode: 'ask',
			},
		});
		expect(accepted).toMatchObject({ status: 'accepted', definitionId: automation.id });
		expect(definitionEvents).toContainEqual({
			definitionId: automation.id,
			definition: automation,
		});
		expect(suggested.at(-1)).toEqual(accepted);
		expect(
			await failure('automations.accept-suggestion', { suggestionId: suggestion.id }),
		).toMatchObject({
			kind: 'invalid-args',
		});
	});

	it('saves the automation as you edited it', async () => {
		const suggestion = await suggestedAfterTwoMerges();

		const { automation } = await context.commands.call('automations.accept-suggestion', {
			suggestionId: suggestion.id,
			automation: {
				name: 'Release notes',
				instructions: 'Draft the release notes.',
				provider: 'claude',
				model: 'sonnet',
				effort: 'low',
				runsIn: 'workstream',
				trigger: { when: suggestion.when, mode: 'auto' },
			},
		});

		expect(automation).toMatchObject({
			name: 'Release notes',
			model: 'sonnet',
			runsIn: 'workstream',
			trigger: { when: suggestion.when, mode: 'auto' },
		});
	});

	it('tells the model what it suggested before once you turn one down', async () => {
		const suggestion = await suggestedAfterTwoMerges();
		expect(
			await context.commands.call('automations.dismiss-suggestion', {
				suggestionId: suggestion.id,
			}),
		).toMatchObject({ status: 'dismissed' });
		expect(await context.commands.call('automations.list-suggestions', undefined)).toEqual([]);

		answers.mockResolvedValue({ same: [], name: '', instructions: '' });
		merge('ws-c', 76, '2026-10-13T09:00:00.000Z');
		ask('ws-c', 'run-76', 'Tag a release', '2026-10-13T09:10:00.000Z');
		merge('ws-d', 77, '2026-10-14T09:00:00.000Z');
		ask('ws-d', 'run-77', 'Is the changelog published?', '2026-10-14T09:10:00.000Z');
		await vi.waitFor(() => expect(answers).toHaveBeenCalledTimes(2));

		expect(answers.mock.calls[1]?.[0]).toContain(
			`Suggested before:\n- Changelog entry: ${changelogHabit.instructions}`,
		);
		expect(suggested).toHaveLength(2);
	});
});

describe('repeat runs', () => {
	function chatTurn(sessionId: string, runId: string, workstreamId: string): void {
		insertSession(db, {
			id: sessionId,
			workstreamId,
			provider: 'claude',
			model: null,
			providerSessionId: null,
			status: 'running',
			startedAt: NOW,
		});
		insertRun(db, {
			id: runId,
			sessionId,
			prompt: 'Ship every workstream',
			startedAt: NOW,
			completedAt: null,
			summary: null,
			error: null,
		});
	}

	it('folds a request for an automation already queued in that workstream into that run', async () => {
		openRuns.add('ws-a');
		const definition = await saveDefinition();
		const first = await runOf(definition, { context: 'Version 2.1' });
		const second = await runOf(definition, { context: 'Version 2.2' });
		const elsewhere = await runOf(definition, { workstreamId: 'ws-b' });

		expect(second).toMatchObject({ id: first.id, status: 'queued', requests: 2 });
		expect(getAutomationRunContext(db, first.id)).toBe('Version 2.1\n\nVersion 2.2');
		expect(elsewhere.id).not.toBe(first.id);
	});

	it('starts a run that waits for you once you ask for that automation again by hand', async () => {
		openRuns.add('ws-a');
		const definition = await saveDefinition();
		const waiting = await runOf(definition, { waitForYou: true, origin: 'trigger' });
		const asked = await runOf(definition);

		expect(waiting.status).toBe('waiting');
		expect(asked).toMatchObject({ id: waiting.id, status: 'queued', requests: 2 });
	});

	it('holds the fourth run of an automation in one workstream from one chain of events until you confirm it', async () => {
		openRuns.add('ws-a');
		openRuns.add('ws-b');
		chatTurn('lead-chat', 'lead-turn', 'ws-c');
		const definition = await saveDefinition();
		const fromTurn = (workstreamId: string) =>
			runOf(definition, { workstreamId, chatSessionId: 'lead-chat', chatAfterRunId: 'lead-turn' });

		const runs = [
			await fromTurn('ws-a'),
			await fromTurn('ws-a'),
			await fromTurn('ws-a'),
			await fromTurn('ws-a'),
		];
		const other = await fromTurn('ws-b');

		expect(runs.map((run) => [run.status, run.chainId])).toEqual([
			['queued', 'lead-turn'],
			['queued', 'lead-turn'],
			['queued', 'lead-turn'],
			['waiting', 'lead-turn'],
		]);
		expect(runs[3]?.detail).toBe(
			'It already ran 3 times in one chain of events, so Malini asks before it runs again.',
		);
		expect(other).toMatchObject({ status: 'queued', chainId: 'lead-turn' });
	});

	it('runs shipping automations in the chain of the read that caused it, outside the budget of that chain', async () => {
		openRuns.add('ws-a');
		const fixChecks = await builtin('fix-checks');
		const read = insertLoggedEvent(db, {
			channel: 'pull-requests:pull-request-changed',
			payload: '{}',
			workstreamId: 'ws-a',
			cause: null,
			chainId: 'chain-of-read',
			emittedAt: NOW,
		});
		const fromQueue = () => runOf(fixChecks, { origin: 'merge-queue', causeEventId: read });

		const runs = [await fromQueue(), await fromQueue(), await fromQueue(), await fromQueue()];
		const triggered = await runOf(fixChecks, { origin: 'trigger', causeEventId: read });

		expect(runs.map((run) => [run.status, run.chainId])).toEqual([
			['queued', 'chain-of-read'],
			['queued', 'chain-of-read'],
			['queued', 'chain-of-read'],
			['queued', 'chain-of-read'],
		]);
		expect(triggered).toMatchObject({ status: 'queued', chainId: 'chain-of-read' });
		expect(automationRunEventIds(db, [runs[0]?.id ?? ''])).toEqual(
			new Map([[runs[0]?.id, [read]]]),
		);
	});
});
