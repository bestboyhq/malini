import type { GroupedRunTimelineItem } from '../activity-group';
import type { RunGroup } from '../render-state';

const LINE_PX = 22;
const BLANK_LINE_PX = 8;
const CHARS_PER_LINE = 110;
const ROW_PX = 24;
const ROW_GAP_PX = 8;
const PROMPT_PX = 74;
const CARD_PX = 80;

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

function estimateTextHeight(text: string): number {
	let height = 0;
	for (const line of text.split('\n')) {
		const length = line.trim().length;
		height += length === 0 ? BLANK_LINE_PX : Math.ceil(length / CHARS_PER_LINE) * LINE_PX;
	}
	return Math.max(ROW_PX, height);
}
