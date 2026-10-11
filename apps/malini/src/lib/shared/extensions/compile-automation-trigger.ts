import { EXTENSION_EVENTS } from '@malini/extension-api';
import { parseAutomationTrigger } from '$contract/automation-trigger';

export type WorkstreamAutomationEvent =
	typeof EXTENSION_EVENTS.workstreamCreated | typeof EXTENSION_EVENTS.resourceReady;

export type CompiledWorkstreamAutomationTrigger = Readonly<{
	event: WorkstreamAutomationEvent | null;
	description: string;
	matches(payload: unknown): boolean;
}>;

export function compileWorkstreamAutomation(when: string): CompiledWorkstreamAutomationTrigger {
	const trigger = parseAutomationTrigger(when);
	if (trigger.kind === 'manual') {
		return { event: null, description: trigger.description, matches: () => false };
	}
	if (trigger.kind === 'workstream-created') {
		return {
			event: EXTENSION_EVENTS.workstreamCreated,
			description: trigger.description,
			matches: () => true,
		};
	}
	const { dockerOnly, frontend } = trigger;
	return {
		event: EXTENSION_EVENTS.resourceReady,
		description: trigger.description,
		matches: (payload) => {
			if (!isRecord(payload)) return false;
			const kind = ownDataProperty(payload, 'kind');
			if (
				(kind !== 'process' && kind !== 'docker') ||
				ownDataProperty(payload, 'state') !== 'ready' ||
				(dockerOnly && kind !== 'docker')
			) {
				return false;
			}
			if (!frontend) return true;
			const identity = ['componentId', 'componentKind', 'name']
				.map((field) => trimmedOwnString(payload, field))
				.filter((value): value is string => Boolean(value))
				.join(' ')
				.toLocaleLowerCase();
			return /\b(?:front end|frontend|web|client|ui)\b/u.test(identity);
		},
	};
}

function ownDataProperty(value: Record<string, unknown>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function trimmedOwnString(value: Record<string, unknown>, key: string): string | null {
	const candidate = ownDataProperty(value, key);
	return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
