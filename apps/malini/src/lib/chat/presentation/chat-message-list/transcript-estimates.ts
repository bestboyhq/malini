import type { TranscriptAnchor } from '$lib/chat/domain/transcript-anchor';
import type { GroupedRunTimelineItem } from '../activity-group';
import type { RunGroup } from '../render-state';
import { rowWindowKey, runWindowKey } from './transcript-window.svelte';

const LINE_PX = 22;
const BLANK_LINE_PX = 8;
const CHARS_PER_LINE = 110;
const ROW_PX = 24;
const ROW_GAP_PX = 8;
const PROMPT_PX = 74;
const CARD_PX = 80;
const ANCHOR_ROWS_BEFORE = 3;

type WindowHeights = (key: string) => number | undefined;

export function estimateRowHeight(item: GroupedRunTimelineItem): number {
	switch (item.kind) {
		case 'assistant':
		case 'plan':
			return estimateTextHeight(item.text);
		case 'approval':
		case 'question':
			return CARD_PX;
		default:
			return ROW_PX;
	}
}

export function estimateRunHeight(run: RunGroup): number {
	let height = PROMPT_PX;
	let inActivity = false;
	for (const item of run.items) {
		if (item.kind === 'assistant' || item.kind === 'plan') {
			height += estimateTextHeight(item.text) + ROW_GAP_PX;
			inActivity = false;
			continue;
		}
		if (item.kind === 'user' || item.kind === 'usage' || item.kind === 'terminal') continue;
		if (!inActivity) height += ROW_PX + ROW_GAP_PX;
		inActivity = true;
	}
	return height + ROW_PX;
}

export function anchoredRowStart(anchor: TranscriptAnchor): number {
	return Math.max(0, anchor.row - ANCHOR_ROWS_BEFORE);
}

export function rowsFillingDown(
	runId: string,
	rows: readonly GroupedRunTimelineItem[],
	from: number,
	budgetPx: number,
	heightOf: WindowHeights,
): Readonly<{ keys: ReadonlySet<string>; heightPx: number }> {
	const keys = new Set<string>();
	let heightPx = 0;
	for (let index = from; index < rows.length && heightPx < budgetPx; index += 1) {
		const row = rows[index];
		if (!row) continue;
		keys.add(row.key);
		heightPx += heightOf(rowWindowKey(runId, row.key)) ?? estimateRowHeight(row);
	}
	return { keys, heightPx };
}

export function openingBudgets(
	runs: readonly RunGroup[],
	heightOf: WindowHeights,
	budgetPx: number,
): ReadonlyMap<string, number> {
	const budgets = new Map<string, number>();
	let budget = budgetPx;
	for (let index = runs.length - 1; index >= 0 && budget > 0; index -= 1) {
		const run = runs[index];
		if (!run) continue;
		budgets.set(run.runId, budget);
		budget -= heightOf(runWindowKey(run.runId)) ?? estimateRunHeight(run);
	}
	return budgets;
}

export function anchoredOpeningBudgets(
	runs: readonly RunGroup[],
	anchor: TranscriptAnchor,
	rowsOf: (run: RunGroup) => readonly GroupedRunTimelineItem[],
	heightOf: WindowHeights,
	budgetPx: number,
): ReadonlyMap<string, number> {
	const budgets = new Map<string, number>();
	const start = runs.findIndex((run) => run.runId === anchor.runId);
	const anchorRun = runs[start];
	if (!anchorRun) return budgets;
	budgets.set(anchorRun.runId, budgetPx);
	const from = anchoredRowStart(anchor);
	let budget =
		budgetPx -
		rowsFillingDown(anchorRun.runId, rowsOf(anchorRun), from, budgetPx, heightOf).heightPx;
	for (let index = start + 1; index < runs.length && budget > 0; index += 1) {
		const run = runs[index];
		if (!run) continue;
		budgets.set(run.runId, budget);
		budget -= heightOf(runWindowKey(run.runId)) ?? estimateRunHeight(run);
	}
	return budgets;
}

function estimateTextHeight(text: string): number {
	let height = 0;
	for (const line of text.split('\n')) {
		const length = line.trim().length;
		height += length === 0 ? BLANK_LINE_PX : Math.ceil(length / CHARS_PER_LINE) * LINE_PX;
	}
	return Math.max(ROW_PX, height);
}
