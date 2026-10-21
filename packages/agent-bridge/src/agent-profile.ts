import { isOneOf, isRecord } from './type-guards.js';

export const AGENT_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const AGENT_RUN_MODES = ['agent', 'plan'] as const;
export const AGENT_ACCESS_LEVELS = ['sandboxed', 'auto', 'full'] as const;
export const AGENT_REPORTS = ['low', 'medium', 'high'] as const;
export const AGENT_THEMES = ['light', 'dark'] as const;

export type AgentReasoningEffort = (typeof AGENT_REASONING_EFFORTS)[number];
export type AgentRunMode = (typeof AGENT_RUN_MODES)[number];
export type AgentAccess = (typeof AGENT_ACCESS_LEVELS)[number];
export type AgentReport = (typeof AGENT_REPORTS)[number];
export type AgentTheme = (typeof AGENT_THEMES)[number];

export interface AgentRunProfile {
	readonly effort: AgentReasoningEffort;
	readonly mode: AgentRunMode;
	readonly access: AgentAccess;
	readonly report?: AgentReport;
}

export function isAgentRunProfile(value: unknown): value is AgentRunProfile {
	if (!isRecord(value)) return false;
	return (
		typeof value.effort === 'string' &&
		isOneOf(AGENT_REASONING_EFFORTS, value.effort) &&
		typeof value.mode === 'string' &&
		isOneOf(AGENT_RUN_MODES, value.mode) &&
		typeof value.access === 'string' &&
		isOneOf(AGENT_ACCESS_LEVELS, value.access) &&
		(value.report === undefined ||
			(typeof value.report === 'string' && isOneOf(AGENT_REPORTS, value.report)))
	);
}

export function isAgentTheme(value: unknown): value is AgentTheme {
	return typeof value === 'string' && isOneOf(AGENT_THEMES, value);
}
