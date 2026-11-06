import type { AgentReasoningEffort } from '$contract/agent';
import type {
	AutomationBoundary,
	AutomationRunMode,
	AutomationRunsIn,
} from '$contract/automations';
import { AGENT_REASONING_EFFORTS } from '$shared/providers/domain/run-profile';

export const AUTOMATION_NAME_MAX_LENGTH = 80;

export const AUTOMATION_INSTRUCTIONS_MAX_LENGTH = 20_000;

export function isAutomationEffort(value: unknown): value is AgentReasoningEffort {
	return AGENT_REASONING_EFFORTS.some((effort) => effort === value);
}

export function isAutomationRunsIn(value: unknown): value is AutomationRunsIn {
	return value === 'workstream' || value === 'new-workstream';
}

export function isAutomationRunMode(value: unknown): value is AutomationRunMode {
	return value === 'off' || value === 'ask' || value === 'auto';
}

export function isAutomationBoundary(value: unknown): value is AutomationBoundary {
	if (typeof value !== 'object' || value === null) return false;
	const fields = new Map(Object.entries(value));
	const event = fields.get('event');
	const chats = fields.get('chats');
	return (
		(event === 'facts' || event === 'full') &&
		(chats === 'none' || chats === 'starter' || chats === 'all') &&
		['before', 'attachments', 'internet'].every((key) => typeof fields.get(key) === 'boolean')
	);
}
