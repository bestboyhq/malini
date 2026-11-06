import { formatToolDuration } from '../render-state';
import type { SubagentStep, SubagentTimelineItem } from '../run-timeline';
import {
	toolActivityLabel,
	toolDescriptionLabel,
	toolDisplayName,
	toolFailureReason,
} from '../tool-display-name';

export function subagentTitle(item: SubagentTimelineItem): string {
	return (
		toolDescriptionLabel(item.tool.name, item.tool.input) ??
		toolDisplayName(item.tool.name, item.tool.input)
	);
}

export function subagentStepLabel(step: SubagentStep): string {
	return (
		toolDescriptionLabel(step.tool.name, step.tool.input) ??
		toolActivityLabel(step.tool.name, step.tool.input)
	);
}

export function subagentPrompt(item: SubagentTimelineItem): string | null {
	const input = item.tool.input;
	if (!isRecord(input)) return null;
	const prompt = input['prompt'];
	return typeof prompt === 'string' && prompt.trim() ? prompt.trim() : null;
}

export function subagentResult(item: SubagentTimelineItem): string | null {
	if (item.report?.trim()) return item.report.trim();
	const output = item.tool.output;
	return typeof output === 'string' && output.trim() ? output.trim() : null;
}

export function subagentTicker(item: SubagentTimelineItem): string | null {
	if (item.tool.status === 'failed') {
		return toolFailureReason(item.tool.error) ?? `${toolDisplayName(item.tool.name)} failed`;
	}
	if (item.tool.status === 'running') {
		const latest = item.steps.at(-1);
		return latest ? subagentStepLabel(latest) : null;
	}
	const result = subagentResult(item);
	return result === null ? null : outcomeLine(result);
}

export function elapsedSeconds(startedAt: number | null, nowMs: number): string | null {
	if (startedAt === null) return null;
	return `${Math.max(0, Math.floor((nowMs - startedAt) / 1_000))}s`;
}

export function stepCount(count: number): string | null {
	if (count === 0) return null;
	return `${count} ${count === 1 ? 'step' : 'steps'}`;
}

export function subagentGroupTitle(agents: readonly SubagentTimelineItem[]): string {
	return `${agents.length} subagents`;
}

export function subagentGroupTicker(agents: readonly SubagentTimelineItem[]): string {
	const back = agents.filter((agent) => agent.tool.status !== 'running').length;
	return `${back} of ${agents.length} back`;
}

export function subagentGroupMeta(
	agents: readonly SubagentTimelineItem[],
	nowMs: number,
	waiting: boolean,
): string | null {
	const starts = agents.flatMap((agent) => agent.tool.startedAt ?? []);
	const startedAt = starts.length > 0 ? Math.min(...starts) : null;
	if (agents.some((agent) => agent.tool.status === 'running')) {
		return waiting ? 'waiting' : elapsedSeconds(startedAt, nowMs);
	}
	const ends = agents.flatMap((agent) => agent.tool.completedAt ?? []);
	const took =
		startedAt === null || ends.length < agents.length
			? null
			: formatToolDuration(Math.max(0, Math.max(...ends) - startedAt));
	const steps = stepCount(agents.reduce((sum, agent) => sum + agent.steps.length, 0));
	const parts = [steps, took].filter((part) => part !== null);
	return parts.length > 0 ? parts.join(' · ') : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function outcomeLine(text: string): string {
	const line = text
		.split('\n')
		.map((part) => part.trim())
		.find(Boolean);
	return (line ?? '')
		.replace(/^#+\s*/u, '')
		.replace(/\*\*|__|`/gu, '')
		.trim();
}
