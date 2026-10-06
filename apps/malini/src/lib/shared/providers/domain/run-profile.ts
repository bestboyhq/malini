export const AGENT_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const AGENT_RUN_MODES = ['agent', 'plan'] as const;
export const AGENT_ACCESS_LEVELS = ['sandboxed', 'auto', 'full'] as const;

export type AgentReasoningEffort = (typeof AGENT_REASONING_EFFORTS)[number];
export type AgentRunMode = (typeof AGENT_RUN_MODES)[number];
export type AgentAccess = (typeof AGENT_ACCESS_LEVELS)[number];

export interface AgentRunProfile {
	effort: AgentReasoningEffort;
	mode: AgentRunMode;
	access: AgentAccess;
}

export const DEFAULT_AGENT_ACCESS: AgentAccess = 'sandboxed';

export const AGENT_ACCESS_DETAILS: Record<AgentAccess, { label: string; description: string }> = {
	sandboxed: {
		label: 'Sandboxed',
		description:
			'Claude Code edits files in the workstream and runs commands in its sandbox. Anything else asks first.',
	},
	auto: {
		label: 'Auto',
		description: "Claude Code's auto mode approves routine actions and asks before risky ones.",
	},
	full: {
		label: 'Full access',
		description: 'Claude Code runs every command and edit without asking.',
	},
};

export const DEFAULT_AGENT_RUN_PROFILE: AgentRunProfile = {
	effort: 'medium',
	mode: 'agent',
	access: DEFAULT_AGENT_ACCESS,
};

export function isValidAgentAccess(value: unknown): value is AgentAccess {
	return AGENT_ACCESS_LEVELS.some((access) => access === value);
}

export function isValidAgentRunProfile(value: unknown): value is AgentRunProfile {
	if (!isRecord(value)) return false;
	return (
		typeof value.effort === 'string' &&
		AGENT_REASONING_EFFORTS.some((effort) => effort === value.effort) &&
		typeof value.mode === 'string' &&
		AGENT_RUN_MODES.some((mode) => mode === value.mode) &&
		isValidAgentAccess(value.access)
	);
}

export function normalizeAgentRunProfile(
	value: unknown,
	defaultAccess: AgentAccess,
): AgentRunProfile | null {
	if (!isRecord(value)) return null;
	const profile = { ...value, access: value.access ?? defaultAccess };
	return isValidAgentRunProfile(profile)
		? { effort: profile.effort, mode: profile.mode, access: profile.access }
		: null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
