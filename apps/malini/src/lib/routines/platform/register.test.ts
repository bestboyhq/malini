import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
	RoutineGatedRunRecord,
	RoutineRecord,
	RoutineSuggestionRecord,
} from '$contract/routines';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { insertRun } from '$lib/chat/platform/runs.repository';
import { insertSession } from '$lib/chat/platform/sessions.repository';
import { upsertProject, upsertWorkstream } from '$shared/repositories/repositories.platform';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { CHAT_AGENT_EVENT_CHANNEL } from '$contract/events';
import type { RoutinesPlatform } from '../routines.platform';
import { ROUTINE_EVENT_CHANNELS } from './commands';
import { registerRoutines } from './register';
import { listGatedRuns } from './routines.repository';

let db: MaliniDatabase;
let context: MainContext;
let service: RoutinesPlatform;
let emitted: { channel: string; payload: unknown }[];

beforeEach(() => {
	db = openMigratedDatabase(':memory:');
	const events = createEventBus({ forwardToWindows: false });
	emitted = [];
	for (const channel of Object.values(ROUTINE_EVENT_CHANNELS)) {
		events.subscribe(channel, (payload) => emitted.push({ channel, payload }));
	}
	context = {
		db,
		commands: new CommandRegistry(),
		events,
		appDataRoot: '/tmp/routines-test',
		resourcesRoot: '/tmp/routines-test',
		isDev: true,
		appVersion: '0.0.0-test',
	};
	service = registerRoutines(context, { log: () => {} });
	seededSessions.clear();
});

afterEach(() => {
	service.dispose();
	db.close();
});

async function invoke<T>(command: string, args?: unknown): Promise<T>;
async function invoke(command: string, args: unknown = {}): Promise<unknown> {
	const response = await context.commands.invoke({ command, args });
	if (!response.ok) throw new Error(response.error);
	return response.value;
}

function seedWorkstream(workstreamId: string): void {
	const projectId = `project-${workstreamId}`;
	upsertProject(db, {
		id: projectId,
		name: projectId,
		repoPath: `/tmp/${projectId}`,
		defaultBranch: 'main',
		createdAt: '2026-09-18T00:00:00Z',
	});
	upsertWorkstream(db, {
		id: workstreamId,
		projectId,
		name: workstreamId,
		path: `/tmp/${workstreamId}`,
		branch: `malini/${workstreamId}`,
		baseBranch: 'main',
		status: 'active',
		createdAt: '2026-09-18T00:00:00Z',
	});
}

let promptSeq = 0;
const seededSessions = new Set<string>();

function submitPrompt(workstreamId: string, prompt: string): void {
	promptSeq += 1;
	const sessionId = `session-${workstreamId}`;
	if (!seededSessions.has(sessionId)) {
		seededSessions.add(sessionId);
		insertSession(db, {
			id: sessionId,
			workstreamId,
			model: null,
			providerSessionId: null,
			status: 'running',
			startedAt: '2026-09-18T00:00:00Z',
		});
	}
	const runId = `run-${promptSeq}`;
	insertRun(db, {
		id: runId,
		sessionId,
		prompt,
		startedAt: `2026-09-18T00:${String(promptSeq).padStart(2, '0')}:00Z`,
		completedAt: null,
		summary: null,
		error: null,
	});
	context.events.emit(CHAT_AGENT_EVENT_CHANNEL, {
		sessionId,
		runId,
		seq: promptSeq,
		event: { type: 'user.message', text: prompt },
	});
}

async function createDraft(overrides: Record<string, unknown> = {}): Promise<RoutineRecord> {
	return invoke<RoutineRecord>('routines.create-draft', {
		label: 'Ensure the preview is running',
		when: 'when a frontend resource becomes ready',
		run: { command: 'malini.preview.open', args: [] },
		...overrides,
	});
}

describe('routine lifecycle commands', () => {
	it('creates a draft, lists it, and walks it draft -> candidate -> routine and back', async () => {
		const draft = await createDraft({
			evidence: [{ kind: 'prompt', text: 'open the preview when the frontend is ready' }],
		});
		expect(draft.status).toBe('draft');
		expect(draft.origin).toBe('user');
		expect(draft.evidence).toEqual([
			{ kind: 'prompt', text: 'open the preview when the frontend is ready' },
		]);

		const listed = await invoke<RoutineRecord[]>('routines.list', undefined);
		expect(listed).toEqual([draft]);

		const candidate = await invoke<RoutineRecord>('routines.promote', {
			routineId: draft.id,
		});
		expect(candidate.status).toBe('candidate');
		const routine = await invoke<RoutineRecord>('routines.promote', {
			routineId: draft.id,
		});
		expect(routine.status).toBe('routine');
		await expect(invoke('routines.promote', { routineId: draft.id })).rejects.toThrow(
			`routine \`${draft.id}\` is already a routine`,
		);

		const demoted = await invoke<RoutineRecord>('routines.demote', { routineId: draft.id });
		expect(demoted.status).toBe('candidate');
		const backToDraft = await invoke<RoutineRecord>('routines.demote', {
			routineId: draft.id,
		});
		expect(backToDraft.status).toBe('draft');
		await expect(invoke('routines.demote', { routineId: draft.id })).rejects.toThrow(
			`routine \`${draft.id}\` is already a draft`,
		);

		expect(
			emitted
				.filter(({ channel }) => channel === ROUTINE_EVENT_CHANNELS.changed)
				.map(({ payload }) => (payload as { change: string }).change),
		).toEqual(['created', 'promoted', 'promoted', 'demoted', 'demoted']);
	});

	it('deletes a routine together with its gated runs', async () => {
		const draft = await createDraft();
		await invoke('routines.promote', { routineId: draft.id });
		await invoke('routines.record-gated-run', {
			id: 'gated-1',
			routineId: draft.id,
			workstreamId: 'workstream-1',
			runKey: 'occurrence-1',
			event: 'malini.resource.ready',
			payload: { workstreamId: 'workstream-1' },
		});
		await invoke('routines.delete', { routineId: draft.id });
		expect(await invoke<RoutineRecord[]>('routines.list', undefined)).toEqual([]);
		expect(listGatedRuns(db)).toEqual([]);
		await expect(invoke('routines.delete', { routineId: draft.id })).rejects.toThrow(
			`routine \`${draft.id}\` not found`,
		);
	});
});

describe('the confirmation gate', () => {
	it('records one pending run per occurrence and settles it exactly once', async () => {
		const draft = await createDraft();
		await invoke('routines.promote', { routineId: draft.id });

		const recorded = await invoke<RoutineGatedRunRecord>('routines.record-gated-run', {
			id: 'gated-1',
			routineId: draft.id,
			workstreamId: 'workstream-1',
			runKey: 'occurrence-1',
			event: 'malini.resource.ready',
			payload: { workstreamId: 'workstream-1', resourceId: 'frontend' },
		});
		expect(recorded.state).toBe('pending');

		const replay = await invoke<RoutineGatedRunRecord>('routines.record-gated-run', {
			id: 'gated-2',
			routineId: draft.id,
			workstreamId: 'workstream-1',
			runKey: 'occurrence-1',
			event: 'malini.resource.ready',
			payload: { workstreamId: 'workstream-1', resourceId: 'frontend' },
		});
		expect(replay.id).toBe('gated-1');

		const pending = await invoke<RoutineGatedRunRecord[]>('routines.list-gated-runs', {
			workstreamId: 'workstream-1',
			state: 'pending',
		});
		expect(pending.map(({ id }) => id)).toEqual(['gated-1']);

		const confirmed = await invoke<RoutineGatedRunRecord>('routines.confirm-run', {
			gatedRunId: 'gated-1',
		});
		expect(confirmed.state).toBe('confirmed');
		expect(confirmed.decidedAt).not.toBeNull();
		await invoke('routines.confirm-run', { gatedRunId: 'gated-1' });
		await expect(invoke('routines.reject-run', { gatedRunId: 'gated-1' })).rejects.toThrow(
			'gated run `gated-1` is already confirmed',
		);

		expect(
			await invoke<RoutineGatedRunRecord[]>('routines.list-gated-runs', { state: 'pending' }),
		).toEqual([]);
	});

	it('rejects a pending run and keeps the occurrence settled', async () => {
		const draft = await createDraft();
		await invoke('routines.promote', { routineId: draft.id });
		await invoke('routines.record-gated-run', {
			id: 'gated-1',
			routineId: draft.id,
			workstreamId: 'workstream-1',
			runKey: 'occurrence-1',
			event: 'malini.resource.ready',
			payload: null,
		});
		const rejected = await invoke<RoutineGatedRunRecord>('routines.reject-run', {
			gatedRunId: 'gated-1',
		});
		expect(rejected.state).toBe('rejected');
		const replay = await invoke<RoutineGatedRunRecord>('routines.record-gated-run', {
			id: 'gated-3',
			routineId: draft.id,
			workstreamId: 'workstream-1',
			runKey: 'occurrence-1',
			event: 'malini.resource.ready',
			payload: null,
		});
		expect(replay).toEqual(rejected);
	});

	it('demoting a candidate to draft discards its pending gated runs', async () => {
		const draft = await createDraft();
		await invoke('routines.promote', { routineId: draft.id });
		await invoke('routines.record-gated-run', {
			id: 'gated-1',
			routineId: draft.id,
			workstreamId: 'workstream-1',
			runKey: 'occurrence-1',
			event: 'malini.resource.ready',
			payload: null,
		});
		await invoke('routines.demote', { routineId: draft.id });
		const runs = await invoke<RoutineGatedRunRecord[]>('routines.list-gated-runs', {});
		expect(runs.map(({ state }) => state)).toEqual(['rejected']);
	});
});

describe('the repeated-prompt nudge', () => {
	it('suggests once when a prompt cluster repeats, with the prompts as evidence', async () => {
		seedWorkstream('workstream-a');
		submitPrompt('workstream-a', 'Update the dependencies and run the tests');
		submitPrompt('workstream-a', 'Open a pull request for the sidebar');
		submitPrompt('workstream-a', 'update the dependencies and run the tests');
		expect(emitted.filter(({ channel }) => channel === ROUTINE_EVENT_CHANNELS.suggested)).toEqual(
			[],
		);

		submitPrompt('workstream-a', 'Please update the dependencies and run the tests');
		const nudges = emitted.filter(({ channel }) => channel === ROUTINE_EVENT_CHANNELS.suggested);
		expect(nudges).toHaveLength(1);
		const { suggestion } = nudges[0]?.payload as { suggestion: RoutineSuggestionRecord };
		expect(suggestion.status).toBe('open');
		expect(suggestion.evidence.map(({ text }) => text)).toEqual([
			'Update the dependencies and run the tests',
			'update the dependencies and run the tests',
			'Please update the dependencies and run the tests',
		]);

		const listed = await invoke<RoutineSuggestionRecord[]>('routines.list-suggestions', undefined);
		expect(listed).toEqual([suggestion]);
	});

	it('never re-nudges the same cluster on later prompts', () => {
		seedWorkstream('workstream-a');
		submitPrompt('workstream-a', 'update the dependencies and run the tests');
		submitPrompt('workstream-a', 'update the dependencies and run the tests');
		submitPrompt('workstream-a', 'update the dependencies and run the tests');
		submitPrompt('workstream-a', 'update the dependencies and run the tests');
		submitPrompt('workstream-a', 'update the dependencies and run the tests');
		expect(
			emitted.filter(({ channel }) => channel === ROUTINE_EVENT_CHANNELS.suggested),
		).toHaveLength(1);
	});

	it('stays silent while every prompt is distinct', () => {
		seedWorkstream('workstream-a');
		submitPrompt('workstream-a', 'Update the dependencies');
		submitPrompt('workstream-a', 'Open a pull request');
		submitPrompt('workstream-a', 'Rename the settings page');
		submitPrompt('workstream-a', 'Delete the stale worktrees');
		expect(emitted.filter(({ channel }) => channel === ROUTINE_EVENT_CHANNELS.suggested)).toEqual(
			[],
		);
	});

	it('clusters repeats across workstreams', () => {
		seedWorkstream('workstream-a');
		seedWorkstream('workstream-b');
		seedWorkstream('workstream-c');
		submitPrompt('workstream-a', 'update the dependencies and run the tests');
		submitPrompt('workstream-b', 'update the dependencies and run the tests');
		submitPrompt('workstream-c', 'update the dependencies and run the tests');
		const nudges = emitted.filter(({ channel }) => channel === ROUTINE_EVENT_CHANNELS.suggested);
		expect(nudges).toHaveLength(1);
		const { suggestion } = nudges[0]?.payload as { suggestion: RoutineSuggestionRecord };
		expect(suggestion.evidence.map(({ workstreamId }) => workstreamId)).toEqual([
			'workstream-a',
			'workstream-b',
			'workstream-c',
		]);
	});

	it('accepting a suggestion drafts a routine with the suggested origin and evidence', async () => {
		seedWorkstream('workstream-a');
		submitPrompt('workstream-a', 'update the dependencies and run the tests');
		submitPrompt('workstream-a', 'update the dependencies and run the tests');
		submitPrompt('workstream-a', 'update the dependencies and run the tests');
		const suggestions = await invoke<RoutineSuggestionRecord[]>(
			'routines.list-suggestions',
			undefined,
		);
		const suggestion = suggestions[0];
		expect(suggestion).toBeDefined();
		if (!suggestion) return;

		const draft = await createDraft({ suggestionId: suggestion.id });
		expect(draft.origin).toBe('suggested');
		expect(draft.evidence).toEqual(suggestion.evidence);
		const accepted = await invoke<RoutineSuggestionRecord[]>(
			'routines.list-suggestions',
			undefined,
		);
		expect(accepted[0]?.status).toBe('accepted');
	});

	it('dismissing a suggestion keeps it recorded so the cluster stays quiet', async () => {
		seedWorkstream('workstream-a');
		submitPrompt('workstream-a', 'update the dependencies and run the tests');
		submitPrompt('workstream-a', 'update the dependencies and run the tests');
		submitPrompt('workstream-a', 'update the dependencies and run the tests');
		const [suggestion] = await invoke<RoutineSuggestionRecord[]>(
			'routines.list-suggestions',
			undefined,
		);
		expect(suggestion).toBeDefined();
		if (!suggestion) return;
		const dismissed = await invoke<RoutineSuggestionRecord>('routines.dismiss-suggestion', {
			suggestionId: suggestion.id,
		});
		expect(dismissed.status).toBe('dismissed');

		submitPrompt('workstream-a', 'update the dependencies and run the tests');
		expect(
			emitted.filter(({ channel }) => channel === ROUTINE_EVENT_CHANNELS.suggested),
		).toHaveLength(1);
	});
});
