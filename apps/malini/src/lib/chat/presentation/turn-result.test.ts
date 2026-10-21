import { describe, expect, it } from 'vitest';
import type { RenderItem, RunGroup } from './render-state';
import { earlierTurnsByRun, finalTurnReport } from './turn-result';

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
});
