import { dirname } from 'node:path';
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

export interface AgentCheckout {
	readonly repository: string;
	readonly branch: string;
	readonly path: string;
}

export interface AgentLead {
	readonly owner: string | null;
	readonly repositories: readonly AgentCheckout[];
	readonly workstreams: readonly AgentCheckout[];
	readonly plan: string;
}

export interface AgentStarter {
	readonly name: string;
	readonly lead: boolean;
	readonly plan: string | null;
}

export interface AgentLineage {
	readonly lead: AgentLead | null;
	readonly startedBy: AgentStarter | null;
	readonly siblings: readonly AgentCheckout[];
}

const MAX_LINEAGE_CHECKOUTS = 500;

export function isAgentLineage(value: unknown): value is AgentLineage {
	if (!isRecord(value)) return false;
	const { lead, startedBy, siblings } = value;
	return (
		(lead === null ||
			(isRecord(lead) &&
				(lead.owner === null || isText(lead.owner)) &&
				isCheckoutList(lead.repositories) &&
				isCheckoutList(lead.workstreams) &&
				isText(lead.plan))) &&
		(startedBy === null ||
			(isRecord(startedBy) &&
				isText(startedBy.name) &&
				typeof startedBy.lead === 'boolean' &&
				(startedBy.plan === null || isText(startedBy.plan)))) &&
		isCheckoutList(siblings)
	);
}

export function lineageDirectories(lineage: AgentLineage | undefined): string[] {
	if (!lineage) return [];
	const { lead, startedBy, siblings } = lineage;
	const checkouts = [...(lead?.repositories ?? []), ...(lead?.workstreams ?? []), ...siblings];
	const plans = startedBy?.plan ? [dirname(startedBy.plan)] : [];
	return [...new Set([...checkouts.map(({ path }) => path), ...plans])];
}

function isCheckoutList(value: unknown): value is AgentCheckout[] {
	return (
		Array.isArray(value) &&
		value.length <= MAX_LINEAGE_CHECKOUTS &&
		value.every(
			(entry) =>
				isRecord(entry) && isText(entry.repository) && isText(entry.branch) && isText(entry.path),
		)
	);
}

function isText(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && !/[\n\r\0]/u.test(value);
}
