import type { TranscriptAnchor } from '$lib/chat/domain/transcript-anchor';
import type { GroupedRunTimelineItem } from '../activity-group';
import type { RunGroup } from '../render-state';
import { foldsWork } from './timeline-derivations.svelte';
import { transcriptTurns, turnRuns, type TranscriptTurn, type TurnRun } from './transcript-turns';
import { rowWindowKey, runWindowKey, type TranscriptWindow } from './transcript-window.svelte';

const LINE_PX = 22.75;
const PARAGRAPH_GAP_PX = 12.25;
const CHAR_PX = 7;
const DEFAULT_TEXT_PX = 776;
const ROW_PX = 24;
const ROW_GAP_PX = 8;
const PROMPT_PX = 74;
const CARD_PX = 80;
const WORKSTREAMS_HEAD_PX = 34;
const WORKSTREAM_LINE_PX = 40;
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
		case 'workstreams':
			return WORKSTREAMS_HEAD_PX + item.workstreamIds.length * WORKSTREAM_LINE_PX;
		default:
			return ROW_PX;
	}
}

export function estimateRunHeight(run: RunGroup, textWidth: number, folded: boolean): number {
	if (folded) {
		const answer = run.items.filter((item) => item.kind === 'assistant').at(-1);
		const answerPx = answer ? estimateTextHeight(answer.text, textWidth) + ROW_GAP_PX : 0;
		return PROMPT_PX + ROW_PX + ROW_GAP_PX + answerPx + ROW_PX;
	}
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

export function estimateTurnHeight(
	runs: readonly RunGroup[],
	turn: TranscriptTurn,
	textWidth: number,
): number {
	return turnRuns(turn).reduce((sum, turnRun) => sum + estimateOf(runs, turnRun, textWidth), 0);
}

export function openingBudgets(
	runs: readonly RunGroup[],
	measure: TranscriptMeasure,
	budgetPx: number,
): ReadonlyMap<string, number> {
	const budgets = new Map<string, number>();
	const turns = transcriptTurns(runs);
	let budget = budgetPx;
	for (let turnIndex = turns.length - 1; turnIndex >= 0 && budget > 0; turnIndex -= 1) {
		const turn = turns[turnIndex];
		if (!turn) continue;
		budgets.set(turn.lead.run.runId, budget);
		const measured = measuredTurnHeight(runs, turn, measure);
		for (let index = turn.continuations.length - 1; index >= 0; index -= 1) {
			const continuation = turn.continuations[index];
			if (!continuation) continue;
			budgets.set(continuation.run.runId, budget);
			if (measured === undefined) budget -= estimateOf(runs, continuation, measure.textWidth);
		}
		budget -= measured ?? estimateOf(runs, turn.lead, measure.textWidth);
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
	const turns = transcriptTurns(runs);
	const start = turns.findIndex((turn) =>
		turnRuns(turn).some(({ run }) => run.runId === anchor.runId),
	);
	const anchorTurn = turns[start];
	if (!anchorTurn) return budgets;
	let budget = budgetPx;
	let belowAnchor = false;
	for (const turnRun of turnRuns(anchorTurn)) {
		budgets.set(turnRun.run.runId, budget);
		if (belowAnchor) budget -= estimateOf(runs, turnRun, measure.textWidth);
		if (turnRun.run.runId !== anchor.runId) continue;
		const rows = rowsOf(turnRun.run);
		budget -= rowsFillingDown(
			anchor.runId,
			rows,
			anchoredRowStart(anchor),
			budget,
			measure,
		).heightPx;
		belowAnchor = true;
	}
	for (let turnIndex = start + 1; turnIndex < turns.length && budget > 0; turnIndex += 1) {
		const turn = turns[turnIndex];
		if (!turn) continue;
		for (const { run } of turnRuns(turn)) budgets.set(run.runId, budget);
		budget -=
			measuredTurnHeight(runs, turn, measure) ?? estimateTurnHeight(runs, turn, measure.textWidth);
	}
	return budgets;
}

function measuredTurnHeight(
	runs: readonly RunGroup[],
	turn: TranscriptTurn,
	measure: TranscriptMeasure,
): number | undefined {
	const { run, index } = turn.lead;
	return measure.heightOf(runWindowKey(run.runId, foldsWork(runs, index)));
}

function estimateOf(runs: readonly RunGroup[], { run, index }: TurnRun, textWidth: number): number {
	return estimateRunHeight(run, textWidth, foldsWork(runs, index));
}

// ponytail: turn report cards are estimated as markdown, ~2x tall; size the card if budgets skew
function estimateTextHeight(text: string, textWidth: number): number {
	const charsPerLine = Math.max(
		1,
		Math.floor((textWidth > 0 ? textWidth : DEFAULT_TEXT_PX) / CHAR_PX),
	);
	let height = 0;
	for (const line of text.split('\n')) {
		const length = line.trim().length;
		height += length === 0 ? PARAGRAPH_GAP_PX : Math.ceil(length / charsPerLine) * LINE_PX;
	}
	return Math.max(ROW_PX, height);
}
