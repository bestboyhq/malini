import { describe, expect, it } from 'vitest';
import {
	CHAT_TURN_FINISHED_CHANNEL,
	JOBS_RUN_FINISHED_CHANNEL,
	REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL,
} from '$contract/events';
import type { ReconcilerCandidate, ReconcilerDecisionRecord } from '$contract/jobs';
import {
	RECONCILER_WAKE_LIMIT,
	outputPick,
	pickOutput,
	promptCandidates,
	reconcilerPrompt,
	reconcilerQuestion,
	ruleHears,
	validatePick,
	wakesInChain,
	type ConflictSituation,
	type JobRunSituation,
	type ReconcilerChat,
	type ReconcilerQuestion,
} from './reconciler';

const LEAD: ReconcilerChat = {
	sessionId: 'lead-chat',
	workstreamId: 'lead',
	chatName: 'Move apps to Logdash',
	workstreamName: 'Home',
	working: false,
	lastOutcome: 'Started two workstreams',
	lastNeeds: null,
};

const API: ReconcilerChat = {
	sessionId: 'api-chat',
	workstreamId: 'api',
	chatName: 'Api analytics',
	workstreamName: 'Api analytics',
	working: true,
	lastOutcome: null,
	lastNeeds: null,
};

const TELL_LEAD = 'Tell “Move apps to Logdash” that Publish docs failed';

function jobRun(overrides: Partial<JobRunSituation> = {}): JobRunSituation {
	return {
		kind: 'job-run',
		title: 'Publish docs',
		status: 'failed',
		detail: 'The docs host timed out',
		workstreamId: 'api',
		workstreamName: 'Api analytics',
		chat: LEAD,
		retry: { definitionId: 'publish-docs', workstreamId: 'api', context: 'Version 2.1' },
		runsInChain: 1,
		wakes: 0,
		...overrides,
	};
}

function conflict(overrides: Partial<ConflictSituation> = {}): ConflictSituation {
	return {
		kind: 'conflict',
		workstreamId: 'api',
		workstreamName: 'Api analytics',
		conflictedPaths: ['src/a.ts', 'src/b.ts'],
		resolverId: 'resolve-conflicts',
		chat: API,
		wakes: 0,
		...overrides,
	};
}

function question(situation: JobRunSituation | ConflictSituation): ReconcilerQuestion {
	const asked = reconcilerQuestion(situation);
	if (!asked) throw new Error('expected a question');
	return asked;
}

function decision(
	candidates: readonly ReconcilerCandidate[],
	chosen: number,
	workstreamId: string | null,
	status: ReconcilerDecisionRecord['status'] = 'done',
): Pick<ReconcilerDecisionRecord, 'candidates' | 'chosen' | 'status' | 'workstreamId'> {
	return { candidates, chosen, status, workstreamId };
}

function overBudget(label: string): string {
	return `Malini already woke this chat ${RECONCILER_WAKE_LIMIT} times about this work in one chain of events, so it asks you first. ${label}?`;
}

describe('the rules', () => {
	it('hands a finished turn to Deliveries, never the model, which hears finished jobs and merge conflicts', () => {
		expect(ruleHears('deliveries', CHAT_TURN_FINISHED_CHANNEL)).toBe(true);
		expect(ruleHears('model', CHAT_TURN_FINISHED_CHANNEL)).toBe(false);
		expect(ruleHears('model', JOBS_RUN_FINISHED_CHANNEL)).toBe(true);
		expect(ruleHears('model', REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL)).toBe(true);
		expect(ruleHears('deliveries', JOBS_RUN_FINISHED_CHANNEL)).toBe(false);
		expect(ruleHears('triggers', CHAT_TURN_FINISHED_CHANNEL)).toBe(true);
	});
});

describe('reconcilerQuestion', () => {
	it('offers to tell the chat that ran a job how it ended, with the report it would send', () => {
		const finished = question(
			jobRun({ status: 'succeeded', detail: 'Published 12 pages', retry: null }),
		);

		expect(finished.candidates).toEqual([
			{ kind: 'nothing', label: 'Do nothing' },
			{
				kind: 'wake-chat',
				label: 'Tell “Move apps to Logdash” that Publish docs finished',
				sessionId: 'lead-chat',
				workstreamId: 'lead',
				from: 'api',
				report: 'Publish docs, the job you ran in “Api analytics”, finished.\n\nPublished 12 pages',
			},
		]);
		expect(finished.facts).toEqual([
			'Event: the job Publish docs in “Api analytics” succeeded.',
			'Its result: Published 12 pages',
			'The chat “Move apps to Logdash” ran it.',
			'“Move apps to Logdash” is idle; its last turn ended with Outcome: Started two workstreams, Needs: nothing.',
			'It ran 1 time in this chain of events.',
			'Malini woke “Move apps to Logdash” about this work 0 of 3 times in this chain of events.',
		]);
	});

	it('offers to run a failed job again and to ask you, and leaves a finished job nobody waits on alone', () => {
		expect(question(jobRun()).candidates).toEqual([
			{ kind: 'nothing', label: 'Do nothing' },
			expect.objectContaining({ kind: 'wake-chat', label: TELL_LEAD }),
			{
				kind: 'run-job',
				label: 'Run Publish docs again',
				definitionId: 'publish-docs',
				workstreamId: 'api',
				context: 'Version 2.1',
			},
			{ kind: 'ask-you', label: 'Ask you', reason: 'Publish docs failed in Api analytics.' },
		]);
		expect(question(jobRun({ chat: null, retry: null, runsInChain: 2 }))).toEqual({
			facts: [
				'Event: the job Publish docs in “Api analytics” failed.',
				'Its result: The docs host timed out',
				'No chat ran it.',
				'It ran 2 times in this chain of events.',
			],
			candidates: [
				{ kind: 'nothing', label: 'Do nothing' },
				{ kind: 'ask-you', label: 'Ask you', reason: 'Publish docs failed in Api analytics.' },
			],
		});
		expect(reconcilerQuestion(jobRun({ status: 'succeeded', chat: null }))).toBeNull();
	});

	it('tells the chat about a job that ran in no workstream from that chat’s own workstream', () => {
		const homeless = question(
			jobRun({ workstreamId: null, workstreamName: null, detail: null, retry: null }),
		);

		expect(homeless.facts[0]).toBe('Event: the job Publish docs failed.');
		expect(homeless.candidates.slice(1)).toEqual([
			expect.objectContaining({
				kind: 'wake-chat',
				from: 'lead',
				report: 'Publish docs, the job you ran, failed.',
			}),
			{ kind: 'ask-you', label: 'Ask you', reason: 'Publish docs failed.' },
		]);
	});

	it('cuts a long job result to a short report and a one-line fact', () => {
		const long = question(jobRun({ detail: `  Timed out\n\n${'x'.repeat(700)}  ` }));

		expect(long.candidates[1]).toMatchObject({
			report: `Publish docs, the job you ran in “Api analytics”, failed.\n\nTimed out\n\n${'x'.repeat(589)}`,
		});
		expect(long.facts).toContain(`Its result: Timed out ${'x'.repeat(590)}`);
	});

	it('offers Resolve conflicts unless it already runs, then to tell the chat working there, then to ask you', () => {
		expect(question(conflict())).toEqual({
			facts: [
				'Event: a merge in “Api analytics” stopped on conflicts in 2 files.',
				'Conflicted: src/a.ts, src/b.ts',
				'Its chat is “Api analytics”.',
				'“Api analytics” is working now.',
				'Malini woke “Api analytics” about this work 0 of 3 times in this chain of events.',
			],
			candidates: [
				{ kind: 'nothing', label: 'Do nothing' },
				{
					kind: 'run-job',
					label: 'Run Resolve conflicts',
					definitionId: 'resolve-conflicts',
					workstreamId: 'api',
					context: 'The merge stopped on conflicts in: src/a.ts, src/b.ts',
				},
				{
					kind: 'wake-chat',
					label: 'Tell “Api analytics” about the conflicts',
					sessionId: 'api-chat',
					workstreamId: 'api',
					from: 'api',
					report: 'A merge in “Api analytics” stopped on conflicts in 2 files: src/a.ts, src/b.ts.',
				},
				{
					kind: 'ask-you',
					label: 'Ask you',
					reason: 'A merge in Api analytics stopped on conflicts in 2 files.',
				},
			],
		});
		expect(
			question(conflict({ resolverId: null, chat: null, conflictedPaths: ['src/a.ts'] })),
		).toEqual({
			facts: [
				'Event: a merge in “Api analytics” stopped on conflicts in 1 file.',
				'Conflicted: src/a.ts',
				'No chat works in it.',
			],
			candidates: [
				{ kind: 'nothing', label: 'Do nothing' },
				{
					kind: 'ask-you',
					label: 'Ask you',
					reason: 'A merge in Api analytics stopped on conflicts in 1 file.',
				},
			],
		});
	});

	it('names at most eight conflicted files to the model', () => {
		const paths = Array.from({ length: 10 }, (_, index) => `src/${index}.ts`);

		expect(question(conflict({ conflictedPaths: paths })).facts[1]).toBe(
			`Conflicted: ${paths.slice(0, 8).join(', ')}`,
		);
	});
});

describe('the state of the chat a wake would reach', () => {
	it('quotes the report of its last turn only when that turn stated one', () => {
		const facts = (chat: ReconcilerChat) => question(jobRun({ chat })).facts;

		expect(facts({ ...LEAD, lastOutcome: null })).toContain('“Move apps to Logdash” is idle.');
		expect(facts({ ...LEAD, lastNeeds: 'Which   Logdash\nproject?' })).toContain(
			'“Move apps to Logdash” is idle; its last turn ended with Outcome: Started two workstreams, Needs: Which Logdash project?.',
		);
		expect(facts({ ...LEAD, working: true })).toContain('“Move apps to Logdash” is working now.');
	});
});

describe('the prompt and the pick', () => {
	it('numbers the candidates after the facts and reads a pick back by its number', () => {
		const asked = question(jobRun());
		const prompt = reconcilerPrompt(asked);
		const labels = promptCandidates(prompt);

		expect(prompt).toBe(
			[
				...asked.facts,
				'',
				'Candidates:',
				'1. Do nothing',
				`2. ${TELL_LEAD}`,
				'3. Run Publish docs again',
				'4. Ask you',
			].join('\n'),
		);
		expect(labels).toEqual(asked.candidates.map((candidate) => candidate.label));
		expect(pickOutput(labels, 3)).toBe('3. Run Publish docs again');
		expect(outputPick(pickOutput(labels, 3))).toBe(3);
		expect(outputPick('Run it again')).toBeNull();
		expect(outputPick(null)).toBeNull();
		expect(promptCandidates('Event: the job Publish docs failed.')).toEqual([]);
	});
});

describe('validatePick', () => {
	const candidates = question(jobRun()).candidates;

	it('keeps the model’s pick while the chat has wakes left, and any pick that wakes no chat', () => {
		expect(validatePick(candidates, 1, () => RECONCILER_WAKE_LIMIT - 1)).toEqual({
			candidates,
			chosen: 1,
			decidedBy: 'model',
			detail: null,
		});
		expect(validatePick(candidates, 2, () => RECONCILER_WAKE_LIMIT)).toEqual({
			candidates,
			chosen: 2,
			decidedBy: 'model',
			detail: null,
		});
		expect(validatePick(candidates, 0, () => 0)).toMatchObject({ chosen: 0, decidedBy: 'model' });
	});

	it('wakes the chat waiting on the work, else asks you, else does nothing, when the model gives no pick', () => {
		const unattended = question(jobRun({ chat: null })).candidates;
		const quiet = candidates.filter(
			(candidate) => candidate.kind === 'nothing' || candidate.kind === 'run-job',
		);

		expect(validatePick(candidates, null, () => 0)).toEqual({
			candidates,
			chosen: 1,
			decidedBy: 'rules',
			detail: null,
		});
		expect(validatePick(candidates, 7, () => 0)).toMatchObject({ chosen: 1, decidedBy: 'rules' });
		expect(unattended[validatePick(unattended, null, () => 0).chosen]).toMatchObject({
			kind: 'ask-you',
		});
		expect(validatePick(quiet, null, () => 0)).toMatchObject({ chosen: 0, decidedBy: 'rules' });
	});

	it('asks you instead of waking a chat that used up its wakes, whoever picked the wake', () => {
		const told = question(jobRun({ status: 'succeeded', retry: null })).candidates;
		const finished = 'Tell “Move apps to Logdash” that Publish docs finished';

		expect(validatePick(candidates, 1, () => RECONCILER_WAKE_LIMIT)).toEqual({
			candidates,
			chosen: 3,
			decidedBy: 'rules',
			detail: overBudget(TELL_LEAD),
		});
		expect(validatePick(candidates, null, () => RECONCILER_WAKE_LIMIT)).toMatchObject({
			chosen: 3,
			decidedBy: 'rules',
		});
		expect(validatePick(told, 1, () => RECONCILER_WAKE_LIMIT)).toEqual({
			candidates: [...told, { kind: 'ask-you', label: 'Ask you', reason: overBudget(finished) }],
			chosen: 2,
			decidedBy: 'rules',
			detail: overBudget(finished),
		});
	});
});

describe('wakesInChain', () => {
	it('counts the wakes of one chat about one piece of work, never the others', () => {
		const candidates = question(jobRun()).candidates;
		const decisions = [
			decision(candidates, 1, 'api'),
			decision(candidates, 1, 'api', 'pending'),
			decision(candidates, 1, 'site'),
			decision(candidates, 1, null),
			decision(candidates, 1, 'api', 'failed'),
			decision(candidates, 2, 'api'),
		];

		expect(wakesInChain(decisions, 'lead-chat', 'api')).toBe(2);
		expect(wakesInChain(decisions, 'lead-chat', 'site')).toBe(1);
		expect(wakesInChain(decisions, 'lead-chat', null)).toBe(1);
		expect(wakesInChain(decisions, 'api-chat', 'api')).toBe(0);
	});
});
