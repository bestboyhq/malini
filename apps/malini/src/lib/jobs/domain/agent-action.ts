import type { AgentActionApproval, AgentActionRecord } from '$contract/jobs';
import { maliniToolApproval, type MaliniNames } from '$lib/chat/domain/approval-request';

const READ_TITLES: Readonly<Record<string, string>> = {
	jobs_list: 'List jobs',
	events_list: 'List events',
	repositories_list: 'List repositories',
	workstreams_list: 'List workstreams',
};

export const AGENT_ACTION_APPROVAL: Readonly<Record<AgentActionApproval, string | null>> = {
	'not-needed': null,
	allowed: 'You allowed it',
	'always-allowed': 'Always allowed',
	denied: 'You denied it',
};

export function agentActionTitle(
	action: Pick<AgentActionRecord, 'tool' | 'input'>,
	names: MaliniNames,
): string {
	return (
		maliniToolApproval(`mcp__malini__${action.tool}`, action.input, names)?.headline ??
		READ_TITLES[action.tool] ??
		action.tool
	);
}

export function agentActionInput(action: Pick<AgentActionRecord, 'input'>): string | null {
	return Object.keys(action.input).length === 0 ? null : JSON.stringify(action.input, null, 2);
}

export function agentActionOutput(action: Pick<AgentActionRecord, 'output'>): string | null {
	if (action.output === null) return null;
	try {
		return JSON.stringify(JSON.parse(action.output), null, 2);
	} catch {
		return action.output;
	}
}
