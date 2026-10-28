import { describe, expect, it } from 'vitest';
import type { ReconcilerCandidate, ReconcilerDecisionRecord } from '$contract/jobs';
import {
	RECONCILER_WAKE_LIMIT,
	outputPick,
	pickOutput,
	promptCandidates,
	reconcilerPrompt,
	reconcilerQuestion,
	rulesReason,
	validatePick,
	wakesInChain,
	type ReconcilerChat,
	type TurnFinishedSituation,
} from './reconciler';

const LEAD: ReconcilerChat = {
	sessionId: 'lead-chat',
	workstreamId: 'lead',
	chatName: 'Move apps to Logdash',
	workstreamName: 'Home',
	working: false,
	lead: true,
	lastOutcome: 'Started two workstreams',
	lastNeeds: null,
};

function finishedTurn(overrides: Partial<TurnFinishedSituation> = {}): TurnFinishedSituation {
	return {
		kind: 'turn-finished',
		workstreamId: 'api',
		workstreamName: 'Api analytics',
		chatName: 'Api analytics',
		status: 'succeeded',
		outcome: 'Added the analytics endpoint',
		needs: null,
		starter: LEAD,
		starterInChain: true,
		siblings: { total: 2, working: 1, needYou: 0 },
		wakes: 0,
		...overrides,
	};
}

function decision(
	candidates: readonly ReconcilerCandidate[],
	chosen: number,
	workstreamId: string,
	status: ReconcilerDecisionRecord['status'] = 'done',
): Pick<ReconcilerDecisionRecord, 'candidates' | 'chosen' | 'status' | 'workstreamId'> {
	return { candidates, chosen, status, workstreamId };
}

describe('reconcilerQuestion', () => {
	it('offers to wake the chat that started the work, with the turn report it would send', () => {
		const question = reconcilerQuestion(finishedTurn());

		expect(question?.candidates.map((candidate) => candidate.label)).toEqual([
			'Do nothing',
			'Wake “Move apps to Logdash” with this report',
		]);
		expect(question?.candidates[1]).toMatchObject({
			kind: 'wake-chat',
			sessionId: 'lead-chat',
			from: 'api',
			report: expect.stringContaining('Outcome: Added the analytics endpoint'),
		});
		expect(question?.facts).toEqual(
			expect.arrayContaining([
				'Event: the chat “Api analytics” finished a turn.',
				'The lead chat “Move apps to Logdash” started it and set this turn going.',
				'“Move apps to Logdash” started 2 workstreams: 1 working, 0 need you, 1 not working.',
			]),
		);
		expect(reconcilerQuestion(finishedTurn({ starterInChain: false }))?.facts).toContain(
			'The lead chat “Move apps to Logdash” started it, but not this turn.',
		);
	});

	it('offers to ask the user when the turn needs something or failed, and nothing for a cancelled turn', () => {
		expect(
			reconcilerQuestion(finishedTurn({ needs: 'Which project?' }))?.candidates.at(-1),
		).toEqual({
			kind: 'ask-you',
			label: 'Ask you',
			reason: '“Api analytics” needs you: Which project?',
		});
		expect(
			reconcilerQuestion(finishedTurn({ status: 'failed', starter: null }))?.candidates,
		).toEqual([
			{ kind: 'nothing', label: 'Do nothing' },
			{ kind: 'ask-you', label: 'Ask you', reason: '“Api analytics” failed.' },
		]);
		expect(reconcilerQuestion(finishedTurn({ status: 'cancelled' }))).toBeNull();
		expect(reconcilerQuestion(finishedTurn({ starter: null }))).toBeNull();
	});

	it('offers to run a failed job again only when Malini can, and to resolve conflicts once', () => {
		const failed = reconcilerQuestion({
			kind: 'job-run',
			title: 'Fix checks',
			status: 'failed',
			detail: 'Timed out',
			workstreamId: 'api',
			workstreamName: 'Api analytics',
			chat: null,
			retry: { definitionId: 'fix-checks', workstreamId: 'api', context: 'PR #4' },
			runsInChain: 1,
			wakes: 0,
		});
		expect(failed?.candidates.map((candidate) => candidate.kind)).toEqual([
			'nothing',
			'run-job',
			'ask-you',
		]);
		expect(failed?.facts).toContain('It ran 1 time in this chain of events.');

		const conflicted = reconcilerQuestion({
			kind: 'conflict',
			workstreamId: 'api',
			workstreamName: 'Api analytics',
			conflictedPaths: ['src/a.ts', 'src/b.ts'],
			resolverId: null,
			chat: null,
			wakes: 0,
		});
		expect(conflicted?.candidates).toEqual([
			{ kind: 'nothing', label: 'Do nothing' },
			{
				kind: 'ask-you',
				label: 'Ask you',
				reason: 'A merge in Api analytics stopped on conflicts in 2 files.',
			},
		]);
	});
});

describe('rulesReason', () => {
	it('wakes the chat that set a turn going by rule when the turn needs something or failed', () => {
		expect(rulesReason(finishedTurn({ needs: 'Which project?' }))).toBe(
			'“Move apps to Logdash” set this turn going, so it hears what the turn needs before you do.',
		);
		expect(rulesReason(finishedTurn({ status: 'failed' }))).toBe(
			'“Move apps to Logdash” set this turn going, so it hears that the turn failed before you do.',
		);
	});

	it('leaves the pick to the model for a turn that needs nothing, or one its starter did not set going', () => {
		expect(rulesReason(finishedTurn())).toBeNull();
		expect(
			rulesReason(finishedTurn({ needs: 'Which project?', starterInChain: false })),
		).toBeNull();
		expect(rulesReason(finishedTurn({ status: 'failed', starter: null }))).toBeNull();
		expect(rulesReason(finishedTurn({ status: 'cancelled', needs: 'Which project?' }))).toBeNull();
		expect(
			rulesReason({
				kind: 'conflict',
				workstreamId: 'api',
				workstreamName: 'Api analytics',
				conflictedPaths: ['src/a.ts'],
				resolverId: null,
				chat: LEAD,
				wakes: 0,
			}),
		).toBeNull();
	});
});

describe('the state of the chat that started the work', () => {
	it('quotes the report of its last turn only when that turn stated one', () => {
		const facts = (lastOutcome: string | null) =>
			reconcilerQuestion(finishedTurn({ starter: { ...LEAD, lastOutcome } }))?.facts ?? [];

		expect(facts(null)).toContain('“Move apps to Logdash” is idle.');
		expect(facts('Started two workstreams')).toContain(
			'“Move apps to Logdash” is idle; its last turn ended with Outcome: Started two workstreams, Needs: nothing.',
		);
		expect(
			reconcilerQuestion(finishedTurn({ starter: { ...LEAD, working: true } }))?.facts,
		).toContain('“Move apps to Logdash” is working now.');
	});
});

describe('the chat a turn ended in', () => {
	it('names its workstream only when the chat has a name of its own', () => {
		expect(
			reconcilerQuestion(finishedTurn({ chatName: 'Endpoint review', needs: 'Which project?' }))
				?.facts[0],
		).toBe('Event: the chat “Endpoint review” in “Api analytics” finished a turn.');
	});
});

describe('the prompt and the pick', () => {
	it('numbers the candidates after the facts and reads a pick back by its number', () => {
		const question = reconcilerQuestion(finishedTurn({ needs: 'Which project?' }));
		if (!question) throw new Error('expected a question');
		const prompt = reconcilerPrompt(question);
		const labels = promptCandidates(prompt);

		expect(labels).toEqual([
			'Do nothing',
			'Wake “Move apps to Logdash” with this report',
			'Ask you',
		]);
		expect(pickOutput(labels, 2)).toBe('2. Wake “Move apps to Logdash” with this report');
		expect(outputPick(pickOutput(labels, 3))).toBe(3);
		expect(outputPick('Wake the lead')).toBeNull();
		expect(outputPick(null)).toBeNull();
	});
});

describe('validatePick', () => {
	const question = reconcilerQuestion(finishedTurn());
	const candidates = question?.candidates ?? [];

	it('keeps the model’s pick while the chat has wakes left', () => {
		expect(validatePick(candidates, 1, () => RECONCILER_WAKE_LIMIT - 1)).toEqual({
			candidates,
			chosen: 1,
			decidedBy: 'model',
			detail: null,
		});
		expect(validatePick(candidates, 0, () => 0)).toMatchObject({ chosen: 0, decidedBy: 'model' });
	});

	it('wakes the chat waiting on the work, else asks you, when the model gives no pick', () => {
		expect(validatePick(candidates, null, () => 0)).toEqual({
			candidates,
			chosen: 1,
			decidedBy: 'rules',
			detail: null,
		});
		expect(validatePick(candidates, 7, () => 0)).toMatchObject({ chosen: 1, decidedBy: 'rules' });
		const unstarted =
			reconcilerQuestion(finishedTurn({ starter: null, status: 'failed' }))?.candidates ?? [];
		const asked = validatePick(unstarted, null, () => 0);

		expect(unstarted[asked.chosen]).toMatchObject({ kind: 'ask-you' });
		expect(asked.decidedBy).toBe('rules');
	});

	it('asks the user instead of waking a chat that used up its wakes', () => {
		const validated = validatePick(candidates, 1, () => RECONCILER_WAKE_LIMIT);

		expect(validated.decidedBy).toBe('rules');
		expect(validated.candidates[validated.chosen]).toMatchObject({
			kind: 'ask-you',
			reason: expect.stringContaining('Wake “Move apps to Logdash” with this report?'),
		});
		expect(validated.candidates.slice(0, candidates.length)).toEqual(candidates);
	});
});

describe('wakesInChain', () => {
	it('counts the wakes of one chat about one piece of work, never the others', () => {
		const wake = reconcilerQuestion(finishedTurn())?.candidates ?? [];
		const decisions = [
			decision(wake, 1, 'api'),
			decision(wake, 1, 'api', 'pending'),
			decision(wake, 1, 'site'),
			decision(wake, 1, 'api', 'failed'),
			decision(wake, 0, 'api'),
		];

		expect(wakesInChain(decisions, 'lead-chat', 'api')).toBe(2);
		expect(wakesInChain(decisions, 'lead-chat', 'site')).toBe(1);
		expect(wakesInChain(decisions, 'other-chat', 'api')).toBe(0);
	});
});
