import { describe, expect, it } from 'vitest';
import type { RenderItem, RunGroup } from './render-state';
import {
	answerTurn,
	earlierTurnsByRun,
	finalTurnReport,
	foldsIntoLaterTurn,
	newestTurnKey,
	runTurns,
	variantPicksByRun,
} from './turn-result';

const REPORT = [
	'![Sticky header](.malini/sandbox/screenshots/header.png)',
	'',
	'- Changed: the header is `position: sticky`.',
	'- Verified: checked at 320 px and 1440 px.',
	'',
	'Outcome: The header stays pinned while the page scrolls.',
	'Needs: Approve the new shadow; Merge the pull request',
].join('\n');

describe('which message becomes the result card', () => {
	const assistant = (key: string, text: string): RenderItem => ({
		kind: 'assistant',
		key,
		seq: 1,
		text,
	});
	const run = (
		terminal: RunGroup['terminal'],
		items: RenderItem[],
		runId = 'run-1',
		superseded = false,
	): RunGroup => {
		const open: RunGroup = {
			runId,
			items,
			terminal,
			terminalText: '',
			failure: null,
			resumeAt: null,
			turnEnded: terminal === 'completed',
			answeredReports: [],
			superseded,
			obsoleted: false,
		};
		return terminal === 'completed' ? answered(open) : open;
	};
	const answered = (group: RunGroup): RunGroup => ({
		...group,
		answeredReports: answerTurn(group),
	});

	it('is only the latest report that answered a turn, even while the run is still open', () => {
		const completed = run('completed', [assistant('a1', 'Looking.'), assistant('a2', REPORT)]);
		const open = run(null, [assistant('a2', REPORT)]);

		expect(finalTurnReport(completed, 'a2', REPORT)?.outcome).toBe(
			'The header stays pinned while the page scrolls.',
		);
		expect(finalTurnReport(completed, 'a1', 'Looking.')).toBeNull();
		expect(finalTurnReport(run('failed', [assistant('a2', REPORT)]), 'a2', REPORT)).toBeNull();
		expect(finalTurnReport(open, 'a2', REPORT)).toBeNull();
		expect(finalTurnReport(answered(open), 'a2', REPORT)?.outcome).toBe(
			'The header stays pinned while the page scrolls.',
		);
		expect(
			finalTurnReport(run('completed', [assistant('a2', 'Plain prose.')]), 'a2', 'Plain prose.'),
		).toBeNull();
	});

	it('moves to the next report the same run answers, and folds the earlier one into it', () => {
		const finished = 'Outcome: The reviewer finished.\nNeeds: nothing';
		const trail = (byRun: ReadonlyMap<string, readonly { key: string }[]>) =>
			[...byRun].map(([runId, turns]) => [runId, turns.map((turn) => turn.key)]);
		const launched = answered(run(null, [assistant('a1', REPORT)]));
		const writing = { ...launched, items: [...launched.items, assistant('a2', finished)] };
		const goesOn = answered(writing);

		expect(finalTurnReport(launched, 'a1', REPORT)).not.toBeNull();
		expect(finalTurnReport(writing, 'a2', finished)).toBeNull();
		expect(foldsIntoLaterTurn(writing, 'a1')).toBe(false);
		expect(goesOn.answeredReports).toEqual(['a1', 'a2']);
		expect(answered(goesOn).answeredReports).toBe(goesOn.answeredReports);
		expect(finalTurnReport(goesOn, 'a1', REPORT)).toBeNull();
		expect(foldsIntoLaterTurn(goesOn, 'a1')).toBe(true);
		expect(finalTurnReport(goesOn, 'a2', finished)?.outcome).toBe('The reviewer finished.');
		expect(trail(earlierTurnsByRun([goesOn]))).toEqual([['run-1', ['a1']]]);

		const later = run('completed', [assistant('b1', 'Outcome: Later.')], 'run-2');
		expect(trail(earlierTurnsByRun([goesOn, later]))).toEqual([
			['run-1', ['a1']],
			['run-2', ['a1', 'a2']],
		]);
	});

	it("stays the last report of the run when Claude Code's own follow-up turn answers after it", () => {
		const followUp = 'That notice is the dev server I used for screenshots stopping.';
		const answeredOnce = run('completed', [
			assistant('a1', REPORT),
			assistant('a2', followUp),
			assistant('a3', 'Still nothing to change.'),
		]);
		const reportedTwice = run('completed', [
			assistant('a1', REPORT),
			assistant('a2', 'Outcome: Shipped the shadow.'),
			assistant('a3', followUp),
		]);

		expect(finalTurnReport(answeredOnce, 'a1', REPORT)?.outcome).toBe(
			'The header stays pinned while the page scrolls.',
		);
		expect(finalTurnReport(answeredOnce, 'a2', followUp)).toBeNull();
		expect(runTurns(answeredOnce).at(-1)?.report.outcome).toBe(
			'The header stays pinned while the page scrolls.',
		);
		expect(finalTurnReport(reportedTwice, 'a1', REPORT)).toBeNull();
		expect(runTurns(reportedTwice).at(-1)?.report.outcome).toBe('Shipped the shadow.');
	});

	it('gives the last three reported turns to the latest result card only, even while a newer run is open', () => {
		const reported = (runId: string, superseded = false): RunGroup =>
			run('completed', [assistant(`${runId}-a`, `Outcome: ${runId} done.`)], runId, superseded);
		const runs = [
			reported('r1'),
			reported('r2'),
			run('completed', [assistant('r3-a', 'Just an answer.')], 'r3'),
			reported('r4', true),
			reported('r5'),
			reported('r6'),
			reported('r7'),
			run(null, [], 'r8'),
		];
		const trail = (byRun: ReadonlyMap<string, readonly { runId: string }[]>) =>
			[...byRun].map(([runId, turns]) => [runId, turns.map((turn) => turn.runId)]);

		expect(trail(earlierTurnsByRun(runs))).toEqual([['r7', ['r2', 'r5', 'r6']]]);
		expect(trail(earlierTurnsByRun(runs.slice(0, 1)))).toEqual([['r1', []]]);
		expect(trail(earlierTurnsByRun(runs.slice(2, 4)))).toEqual([]);
	});

	it('names the newest report past answers, superseded runs and an open run', () => {
		const reported = (runId: string, superseded = false): RunGroup =>
			run('completed', [assistant(`${runId}-a`, `Outcome: ${runId} done.`)], runId, superseded);
		const runs = [
			reported('r1'),
			reported('r2'),
			run('completed', [assistant('r3-a', 'Just an answer.')], 'r3'),
			reported('r4', true),
			run(null, [], 'r5'),
		];

		expect(newestTurnKey(runs)).toBe('r2-a');
		expect(newestTurnKey([...runs, reported('r6')])).toBe('r6-a');
		expect(newestTurnKey(runs.slice(2))).toBeNull();
	});

	it('pairs each pick with the variants offered right before it, and keeps an unchanged pick as it was', () => {
		const user = (key: string, text: string): RenderItem => ({ kind: 'user', key, seq: 0, text });
		const offer = [
			'![Variant A: Calm](a.png)',
			'![Variant B: Bold](b.png)',
			'',
			'Outcome: Two directions.',
		].join('\n');
		const runs = [
			run('completed', [user('u1', 'Directions please'), assistant('a1', offer)], 'r1'),
			run('completed', [user('u2', 'Fix the footer'), assistant('a2', 'Done.')], 'r2'),
			run(
				'completed',
				[user('u3', 'Go with variant B (Bold).\nWhy: darker'), assistant('a3', 'Ok.')],
				'r3',
			),
			run(null, [user('u4', 'Go with variant A (Calm).')], 'r4', true),
		];

		const turns = new Map(runs.map((each) => [each.runId, runTurns(each)]));
		const cached = (each: RunGroup) => turns.get(each.runId) ?? [];
		const picks = variantPicksByRun(runs, cached);
		const pick = picks.get('a1');

		expect([...picks.keys()]).toEqual(['a1']);
		expect(pick?.promptRunId).toBe('r3');
		expect(pick?.pick.picked.name).toBe('Bold');
		expect(pick?.pick.reason).toBe('darker');
		expect(variantPicksByRun(runs, cached, picks).get('a1')).toBe(pick);
	});
});
