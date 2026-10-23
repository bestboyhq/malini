import { hasTurnReport, parseTurnReport, type TurnReport } from '$lib/chat/domain/turn-report';
import { readVariantPick, type VariantPick } from '$lib/chat/domain/variant-pick';
import type { RenderItem, RunGroup } from './render-state';

export type EarlierTurn = Readonly<{ runId: string; report: TurnReport }>;

export type RunPick = Readonly<{ reportRunId: string; promptRunId: string; pick: VariantPick }>;

const EARLIER_TURN_LIMIT = 3;

export function finalTurnReport(run: RunGroup, itemKey: string, text: string): TurnReport | null {
	if (!run.turnEnded || lastAssistant(run)?.key !== itemKey) return null;
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

export function variantPicksByRun(
	runs: readonly RunGroup[],
	turnFor: (run: RunGroup) => EarlierTurn | null = runTurn,
	previous: ReadonlyMap<string, RunPick> = new Map(),
): ReadonlyMap<string, RunPick> {
	const picks = new Map<string, RunPick>();
	let offered: EarlierTurn | null = null;
	for (const run of runs) {
		if (run.superseded || run.obsoleted) continue;
		const prompt = openingPrompt(run);
		const pick =
			offered && prompt !== null ? readVariantPick(prompt, offered.report.variants) : null;
		if (offered && pick) {
			const prior = previous.get(offered.runId);
			picks.set(
				offered.runId,
				prior && samePick(prior, run.runId, pick)
					? prior
					: { reportRunId: offered.runId, promptRunId: run.runId, pick },
			);
		}
		offered = turnFor(run) ?? offered;
	}
	return picks;
}

function samePick(prior: RunPick, promptRunId: string, pick: VariantPick): boolean {
	return (
		prior.promptRunId === promptRunId &&
		prior.pick.picked.id === pick.picked.id &&
		prior.pick.reason === pick.reason &&
		prior.pick.options === pick.options
	);
}

function openingPrompt(run: RunGroup): string | null {
	const opening = run.items.find((item) => item.kind === 'user');
	return opening?.kind === 'user' ? opening.text : null;
}

function lastAssistant(run: RunGroup): Extract<RenderItem, { kind: 'assistant' }> | null {
	for (let index = run.items.length - 1; index >= 0; index -= 1) {
		const item = run.items[index];
		if (item?.kind === 'assistant') return item;
	}
	return null;
}
