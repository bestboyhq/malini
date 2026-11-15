import type { SandboxProblem } from '$contract/agent';
import { WINDOWS_SANDBOX_PROBLEM_LINES } from './windows-sandbox';
export const AGENT_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const AGENT_RUN_MODES = ['agent', 'plan'] as const;
export const AGENT_ACCESS_LEVELS = ['sandboxed', 'auto', 'full'] as const;
export const AGENT_REPORTS = ['low', 'medium', 'high'] as const;

export type AgentReasoningEffort = (typeof AGENT_REASONING_EFFORTS)[number];
export type AgentRunMode = (typeof AGENT_RUN_MODES)[number];
export type AgentAccess = (typeof AGENT_ACCESS_LEVELS)[number];
export type AgentReport = (typeof AGENT_REPORTS)[number];

export interface AgentRunProfile {
	effort: AgentReasoningEffort;
	mode: AgentRunMode;
	access: AgentAccess;
	report: AgentReport;
}

export const DEFAULT_AGENT_ACCESS: AgentAccess = 'auto';

export const AGENT_ACCESS_DETAILS: Record<AgentAccess, { label: string; description: string }> = {
	sandboxed: {
		label: 'Sandboxed',
		description:
			"Claude Code edits files in the workstream and runs commands in Malini's sandbox. Anything else asks first.",
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

export const SANDBOX_PROBLEM_LINES: Record<SandboxProblem, string> = {
	missing:
		"Malini's sandbox needs bubblewrap, so every command asks first. Install bubblewrap, then restart Malini.",
	outdated:
		"This computer's bubblewrap is too old for Malini's sandbox, so every command asks first. Update it to 0.8 or later, then restart Malini.",
	blocked:
		'This computer does not let Malini open a sandbox, so every command asks first. Install the .deb, or run sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0.',
	nested:
		'Malini already runs in a sandbox, so it cannot open another one, and every command asks first.',
	unsupported: 'Malini has no sandbox for this computer yet, so every command asks first.',
	'not-set-up': "Malini's sandbox is not set up yet, so every command asks first.",
};

export function sandboxProblemLine(
	problem: SandboxProblem | null,
	platform: string,
): string | null {
	if (problem === null) return null;
	const windowsLine = platform === 'win32' ? WINDOWS_SANDBOX_PROBLEM_LINES[problem] : undefined;
	return windowsLine ?? SANDBOX_PROBLEM_LINES[problem];
}

export const DEFAULT_AGENT_REPORT: AgentReport = 'medium';

export const AGENT_REPORT_DETAILS: Record<AgentReport, { label: string; description: string }> = {
	low: { label: 'Low', description: 'A screenshot and one line' },
	medium: { label: 'Medium', description: 'Plus what it needs from you and up to three points' },
	high: { label: 'High', description: 'The full write-up' },
};

export const DEFAULT_AGENT_RUN_PROFILE: AgentRunProfile = {
	effort: 'medium',
	mode: 'agent',
	access: DEFAULT_AGENT_ACCESS,
	report: DEFAULT_AGENT_REPORT,
};

export function isValidAgentAccess(value: unknown): value is AgentAccess {
	return AGENT_ACCESS_LEVELS.some((access) => access === value);
}

export function isValidReasoningEffort(value: unknown): value is AgentReasoningEffort {
	return AGENT_REASONING_EFFORTS.some((effort) => effort === value);
}

export function reasoningEffortLabel(effort: AgentReasoningEffort): string {
	if (effort === 'xhigh') return 'Extra high';
	return `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
}

export function isValidAgentRunProfile(value: unknown): value is AgentRunProfile {
	if (!isRecord(value)) return false;
	return (
		isValidReasoningEffort(value.effort) &&
		typeof value.mode === 'string' &&
		AGENT_RUN_MODES.some((mode) => mode === value.mode) &&
		isValidAgentAccess(value.access) &&
		AGENT_REPORTS.some((report) => report === value.report)
	);
}

export function normalizeAgentRunProfile(
	value: unknown,
	defaultAccess: AgentAccess,
): AgentRunProfile | null {
	if (!isRecord(value)) return null;
	const profile = {
		...value,
		access: value.access ?? defaultAccess,
		report: value.report ?? DEFAULT_AGENT_REPORT,
	};
	return isValidAgentRunProfile(profile)
		? {
				effort: profile.effort,
				mode: profile.mode,
				access: profile.access,
				report: profile.report,
			}
		: null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
