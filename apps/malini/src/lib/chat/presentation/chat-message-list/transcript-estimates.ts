import type { TranscriptAnchor } from '$lib/chat/domain/transcript-anchor';
import type { GroupedRunTimelineItem } from '../activity-group';
import type { RunGroup } from '../render-state';
import { rowWindowKey, runWindowKey, type TranscriptWindow } from './transcript-window.svelte';

const LINE_PX = 22;
const BLANK_LINE_PX = 8;
const CHAR_PX = 7;
const DEFAULT_TEXT_PX = 776;
const ROW_PX = 24;
const ROW_GAP_PX = 8;
const PROMPT_PX = 74;
const CARD_PX = 80;
const ANCHOR_ROWS_BEFORE = 3;

type TranscriptMeasure = Pick<TranscriptWindow, 'heightOf' | 'textWidth'>;

export function estimateRowHeight(item: GroupedRunTimelineItem, textWidth: number): number {
	switch (item.kind) {
		case 'assistant':
		case 'plan':
			return estimateTextHeight(item.text, textWidth);
		case 'approval':
		case 'question':
			return CARD_PX;
		default:
			return ROW_PX;
	}
}

export function estimateRunHeight(run: RunGroup, textWidth: number): number {
	let height = PROMPT_PX;
	let inActivity = false;
	for (const item of run.items) {
		if (item.kind === 'assistant' || item.kind === 'plan') {
			height += estimateTextHeight(item.text, textWidth) + ROW_GAP_PX;
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
	measure: TranscriptMeasure,
): Readonly<{ keys: ReadonlySet<string>; heightPx: number }> {
	const keys = new Set<string>();
	let heightPx = 0;
	for (let index = from; index < rows.length && heightPx < budgetPx; index += 1) {
		const row = rows[index];
		if (!row) continue;
		keys.add(row.key);
		heightPx +=
			measure.heightOf(rowWindowKey(runId, row.key)) ?? estimateRowHeight(row, measure.textWidth);
	}
	return { keys, heightPx };
}

export function openingBudgets(
	runs: readonly RunGroup[],
	measure: TranscriptMeasure,
	budgetPx: number,
): ReadonlyMap<string, number> {
	const budgets = new Map<string, number>();
	let budget = budgetPx;
	for (let index = runs.length - 1; index >= 0 && budget > 0; index -= 1) {
		const run = runs[index];
		if (!run) continue;
		budgets.set(run.runId, budget);
		budget -=
			measure.heightOf(runWindowKey(run.runId)) ?? estimateRunHeight(run, measure.textWidth);
	}
	return budgets;
}

export function anchoredOpeningBudgets(
	runs: readonly RunGroup[],
	anchor: TranscriptAnchor,
	rowsOf: (run: RunGroup) => readonly GroupedRunTimelineItem[],
	measure: TranscriptMeasure,
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
		rowsFillingDown(anchorRun.runId, rowsOf(anchorRun), from, budgetPx, measure).heightPx;
	for (let index = start + 1; index < runs.length && budget > 0; index += 1) {
		const run = runs[index];
		if (!run) continue;
		budgets.set(run.runId, budget);
		budget -=
			measure.heightOf(runWindowKey(run.runId)) ?? estimateRunHeight(run, measure.textWidth);
	}
	return budgets;
}

function estimateTextHeight(text: string, textWidth: number): number {
	const charsPerLine = Math.max(
		1,
		Math.floor((textWidth > 0 ? textWidth : DEFAULT_TEXT_PX) / CHAR_PX),
	);
	let height = 0;
	for (const line of text.split('\n')) {
		const length = line.trim().length;
		height += length === 0 ? BLANK_LINE_PX : Math.ceil(length / charsPerLine) * LINE_PX;
	}
	return Math.max(ROW_PX, height);
}
