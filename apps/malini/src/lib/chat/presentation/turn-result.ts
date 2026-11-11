import { hasTurnReport, parseTurnReport, type TurnReport } from '$lib/chat/domain/turn-report';
import { readVariantPick, type VariantPick } from '$lib/chat/domain/variant-pick';
import type { RenderItem, RunGroup } from './render-state';

export type EarlierTurn = Readonly<{ runId: string; key: string; report: TurnReport }>;

export type RunPick = Readonly<{ reportKey: string; promptRunId: string; pick: VariantPick }>;

const EARLIER_TURN_LIMIT = 3;

export function answerTurn(run: RunGroup): readonly string[] {
	const key = lastReport(run)?.key;
	return key === undefined || run.answeredReports.includes(key)
		? run.answeredReports
		: [...run.answeredReports, key];
}

export function finalTurnReport(run: RunGroup, itemKey: string, text: string): TurnReport | null {
	if (run.answeredReports.at(-1) !== itemKey || !hasTurnReport(text)) return null;
	return parseTurnReport(text);
}

export function foldsIntoLaterTurn(run: RunGroup, itemKey: string): boolean {
	const index = run.answeredReports.indexOf(itemKey);
	return index >= 0 && index < run.answeredReports.length - 1;
}

export function runTurns(run: RunGroup): readonly EarlierTurn[] {
	return run.answeredReports.flatMap((key) => {
		const item = run.items.find((candidate) => candidate.key === key);
		return item?.kind === 'assistant'
			? [{ runId: run.runId, key, report: parseTurnReport(item.text) }]
			: [];
	});
}

export function earlierTurnsByRun(
	runs: readonly RunGroup[],
	turnsFor: (run: RunGroup) => readonly EarlierTurn[] = runTurns,
): Map<string, readonly EarlierTurn[]> {
	const byRun = new Map<string, readonly EarlierTurn[]>();
	let before: readonly EarlierTurn[] = [];
	let latest: readonly EarlierTurn[] = [];
	for (const run of runs) {
		if (run.superseded || run.obsoleted) continue;
		const turns = turnsFor(run);
		if (turns.length === 0) continue;
		if (turns.length > 1) byRun.set(run.runId, turns.slice(0, -1));
		before = [...before, ...latest].slice(-EARLIER_TURN_LIMIT);
		latest = turns;
	}
	const last = latest.at(-1);
	if (!last) return byRun;
	const own = latest.slice(0, -1);
	byRun.set(last.runId, [...before, ...own].slice(-Math.max(EARLIER_TURN_LIMIT, own.length)));
	return byRun;
}

export function variantPicksByRun(
	runs: readonly RunGroup[],
	turnsFor: (run: RunGroup) => readonly EarlierTurn[] = runTurns,
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
			const prior = previous.get(offered.key);
			picks.set(
				offered.key,
				prior && samePick(prior, run.runId, pick)
					? prior
					: { reportKey: offered.key, promptRunId: run.runId, pick },
			);
		}
		offered = turnsFor(run).at(-1) ?? offered;
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

function lastReport(run: RunGroup): Extract<RenderItem, { kind: 'assistant' }> | null {
	for (let index = run.items.length - 1; index >= 0; index -= 1) {
		const item = run.items[index];
		if (item?.kind === 'assistant' && hasTurnReport(item.text)) return item;
	}
	return null;
}
