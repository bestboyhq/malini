import { parseAutomationTrigger } from '$contract/automation-trigger';
import type { EventChannel } from '$contract/events';
import {
	isAgentlessAutomationBuiltin,
	isOneShotAutomationBuiltin,
	type AutomationBoundary,
	type AutomationDefinitionRecord,
} from '$contract/automations';

type BoundaryAutomation = Pick<
	AutomationDefinitionRecord,
	'id' | 'builtin' | 'trigger' | 'thenAutomationId' | 'boundary'
>;

export const WORDLESS_BOUNDARY: Pick<
	AutomationBoundary,
	'event' | 'before' | 'chats' | 'attachments'
> = {
	event: 'facts',
	before: false,
	chats: 'none',
	attachments: false,
};

export function runsAnAgent(automation: Pick<AutomationDefinitionRecord, 'builtin'>): boolean {
	return (
		!isAgentlessAutomationBuiltin(automation.builtin) &&
		!isOneShotAutomationBuiltin(automation.builtin)
	);
}

export function triggerChannel(
	automation: Pick<AutomationDefinitionRecord, 'trigger'>,
): EventChannel | null {
	const when = automation.trigger?.when;
	if (!when?.startsWith('on ')) return null;
	const trigger = parseAutomationTrigger(when);
	return trigger.kind === 'event' ? trigger.channel : null;
}

export function automationsBefore<T extends BoundaryAutomation>(
	automation: BoundaryAutomation,
	automations: readonly T[],
): T[] {
	return automations.filter(
		(other) => other.thenAutomationId === automation.id && other.id !== automation.id,
	);
}

export function seesYourWords(
	automation: BoundaryAutomation,
	automations: readonly BoundaryAutomation[],
	visited: ReadonlySet<string> = new Set(),
): boolean {
	if (!runsAnAgent(automation) || visited.has(automation.id)) return false;
	const { event, before, chats, attachments } = automation.boundary;
	if (chats !== 'none' || attachments) return true;
	if (event === 'full' && triggerChannel(automation) !== null) return true;
	const seen = new Set([...visited, automation.id]);
	return (
		before &&
		automationsBefore(automation, automations).some((other) =>
			seesYourWords(other, automations, seen),
		)
	);
}

export function publishingThen<T extends BoundaryAutomation>(
	automation: BoundaryAutomation,
	automations: readonly T[],
): T | null {
	const then = automations.find((other) => other.id === automation.thenAutomationId);
	return then?.builtin === 'open-draft' || then?.builtin === 'merge' ? then : null;
}

export function canLeak(
	automation: BoundaryAutomation,
	automations: readonly BoundaryAutomation[],
): boolean {
	return (
		seesYourWords(automation, automations) &&
		(automation.boundary.internet || publishingThen(automation, automations) !== null)
	);
}
