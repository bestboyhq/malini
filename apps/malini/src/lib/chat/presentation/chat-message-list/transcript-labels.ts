import { PAUSED_FOR_EXIT_ERROR } from '$contract/agent-state-machine';
import type { RunGroup } from '../render-state';

const STEP_BREAK = /\n\s*\n/u;
const SENTENCE_BREAK = /(?<=[.!?…])\s+(?=\S)/u;

function plain(text: string): string {
	return text
		.replace(/\*\*|__|`/gu, '')
		.replace(/\s+/gu, ' ')
		.trim();
}

export function thinkingSteps(text: string): string[] {
	return text
		.split(STEP_BREAK)
		.map((step) => step.trim())
		.filter(Boolean);
}

export function thinkingTicker(text: string): { key: number; line: string } {
	const sentences = thinkingSteps(text).flatMap((step) => step.split(SENTENCE_BREAK));
	return { key: sentences.length, line: plain(sentences.at(-1) ?? '') };
}

export function thinkingOutcome(text: string): string {
	return plain(thinkingSteps(text).at(-1) ?? '');
}

export function thoughtLabel(durationSeconds: number | null): string {
	if (durationSeconds === null) return 'Thought';
	return durationSeconds >= 1 ? `Thought for ${Math.round(durationSeconds)}s` : 'Thought briefly';
}

export function terminalLabel(run: RunGroup): string {
	if (run.terminal === 'paused') return 'Run paused';
	if (run.terminal === 'cancelled') {
		return run.terminalText === PAUSED_FOR_EXIT_ERROR ? 'Run paused' : 'Run cancelled';
	}
	return 'Run failed';
}
