import { PAUSED_FOR_EXIT_ERROR } from '$contract/agent-state-machine';
import type { RenderItem, RunGroup } from '../render-state';

const THINKING_PREVIEW_LIMIT = 240;

export function thinkingPreview(text: string): string {
	const prefix = text.slice(0, THINKING_PREVIEW_LIMIT).replace(/\s+/gu, ' ').trim();
	return text.length > THINKING_PREVIEW_LIMIT ? `${prefix}…` : prefix;
}

export function thoughtLabel(durationSeconds: number | null): string {
	return durationSeconds && durationSeconds >= 1
		? `Thought for ${Math.round(durationSeconds)}s`
		: 'Thought briefly';
}

export function terminalLabel(run: RunGroup): string {
	if (run.terminal === 'cancelled') {
		return run.terminalText === PAUSED_FOR_EXIT_ERROR ? 'Run paused' : 'Run cancelled';
	}
	return 'Run failed';
}

export function formatUsage(item: RenderItem, showsCost: boolean): string {
	if (item.kind !== 'usage') return '';
	const inT = item.inputTokens ?? 0;
	const outT = item.outputTokens ?? 0;
	const tokens = `${inT.toLocaleString()} input · ${outT.toLocaleString()} output`;
	return showsCost && item.costUsd !== null ? `${tokens} · $${item.costUsd.toFixed(2)}` : tokens;
}
