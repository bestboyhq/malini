import { hasTurnReport, parseTurnReport, type TurnReport } from '$lib/chat/domain/turn-report';
import type { RenderItem, RunGroup } from './render-state';

export type EarlierTurn = Readonly<{ runId: string; report: TurnReport }>;

const EARLIER_TURN_LIMIT = 3;

export function finalTurnReport(run: RunGroup, itemKey: string, text: string): TurnReport | null {
	if (run.terminal !== 'completed' || lastAssistant(run)?.key !== itemKey) return null;
	const report = parseTurnReport(text);
	return hasTurnReport(report) ? report : null;
}

export function runTurn(run: RunGroup): EarlierTurn | null {
	const answer = lastAssistant(run);
	const report = answer ? finalTurnReport(run, answer.key, answer.text) : null;
	return report ? { runId: run.runId, report } : null;
}

export function earlierTurnsByRun(
	runs: readonly RunGroup[],
	turnFor: (run: RunGroup) => EarlierTurn | null = runTurn,
): Map<string, readonly EarlierTurn[]> {
	let latest: EarlierTurn | null = null;
	let earlier: readonly EarlierTurn[] = [];
	for (const run of runs) {
		if (run.superseded || run.obsoleted) continue;
		const turn = turnFor(run);
		if (!turn) continue;
		if (latest) earlier = [...earlier, latest].slice(-EARLIER_TURN_LIMIT);
		latest = turn;
	}
	return latest ? new Map([[latest.runId, earlier]]) : new Map();
}

function lastAssistant(run: RunGroup): Extract<RenderItem, { kind: 'assistant' }> | null {
	for (let index = run.items.length - 1; index >= 0; index -= 1) {
		const item = run.items[index];
		if (item?.kind === 'assistant') return item;
	}
	return null;
}
