import { describe, expect, it } from 'vitest';
import type { RenderItem, RunGroup } from './render-state';
import { earlierTurnsByRun, finalTurnReport, runTurn, variantPicksByRun } from './turn-result';

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
	): RunGroup => ({
		runId,
		items,
		terminal,
		terminalText: '',
		superseded,
		obsoleted: false,
	});

	it('is only the last answer of a completed run that carries a report', () => {
		const completed = run('completed', [assistant('a1', 'Looking.'), assistant('a2', REPORT)]);

		expect(finalTurnReport(completed, 'a2', REPORT)?.outcome).toBe(
			'The header stays pinned while the page scrolls.',
		);
		expect(finalTurnReport(completed, 'a1', 'Looking.')).toBeNull();
		expect(finalTurnReport(run('failed', [assistant('a2', REPORT)]), 'a2', REPORT)).toBeNull();
		expect(finalTurnReport(run(null, [assistant('a2', REPORT)]), 'a2', REPORT)).toBeNull();
		expect(
			finalTurnReport(run('completed', [assistant('a2', 'Plain prose.')]), 'a2', 'Plain prose.'),
		).toBeNull();
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

		const turns = new Map(runs.map((each) => [each.runId, runTurn(each)]));
		const cached = (each: RunGroup) => turns.get(each.runId) ?? null;
		const picks = variantPicksByRun(runs, cached);
		const pick = picks.get('r1');

		expect([...picks.keys()]).toEqual(['r1']);
		expect(pick?.promptRunId).toBe('r3');
		expect(pick?.pick.picked.name).toBe('Bold');
		expect(pick?.pick.reason).toBe('darker');
		expect(variantPicksByRun(runs, cached, picks).get('r1')).toBe(pick);
	});
});
