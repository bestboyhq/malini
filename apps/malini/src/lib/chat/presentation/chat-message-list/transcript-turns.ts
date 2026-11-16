import { continuationCause } from '$contract/agent-state-machine';
import type { RunGroup } from '../render-state';

export type TurnRun = Readonly<{ run: RunGroup; index: number }>;

export type TranscriptTurn = Readonly<{ lead: TurnRun; continuations: readonly TurnRun[] }>;

export function transcriptTurns(runs: readonly RunGroup[]): readonly TranscriptTurn[] {
	const turns: { lead: TurnRun; continuations: TurnRun[] }[] = [];
	runs.forEach((run, index) => {
		const turn = turns.at(-1);
		if (turn && continuesPreviousRun(run) && run.superseded === turn.lead.run.superseded) {
			turn.continuations.push({ run, index });
		} else {
			turns.push({ lead: { run, index }, continuations: [] });
		}
	});
	return turns;
}

export function turnRuns(turn: TranscriptTurn): readonly TurnRun[] {
	return [turn.lead, ...turn.continuations];
}

function continuesPreviousRun(run: RunGroup): boolean {
	const opening = run.items.find((item) => item.kind === 'user');
	return opening?.kind === 'user' && continuationCause(opening.text) !== null;
}
