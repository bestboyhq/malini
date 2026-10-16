import { hasTurnReport, parseTurnReport, type TurnReport } from '$lib/chat/domain/turn-report';
import type { RenderItem, RunGroup } from './render-state';

export type EarlierTurn = Readonly<{ runId: string; report: TurnReport }>;

const EARLIER_TURN_LIMIT = 3;

export function finalTurnReport(run: RunGroup, itemKey: string, text: string): TurnReport | null {
	if (run.terminal !== 'completed' || lastAssistant(run)?.key !== itemKey) return null;
	const report = parseTurnReport(text);
	return hasTurnReport(report) ? report : null;
}

export function earlierTurns(runs: readonly RunGroup[], runId: string): EarlierTurn[] {
	const end = runs.findIndex((run) => run.runId === runId);
	const turns: EarlierTurn[] = [];
	for (const run of runs.slice(0, Math.max(end, 0))) {
		if (run.superseded || run.obsoleted) continue;
		const answer = lastAssistant(run);
		const report = answer ? finalTurnReport(run, answer.key, answer.text) : null;
		if (report) turns.push({ runId: run.runId, report });
	}
	return turns.slice(-EARLIER_TURN_LIMIT);
}

function lastAssistant(run: RunGroup): Extract<RenderItem, { kind: 'assistant' }> | null {
	for (let index = run.items.length - 1; index >= 0; index -= 1) {
		const item = run.items[index];
		if (item?.kind === 'assistant') return item;
	}
	return null;
}
