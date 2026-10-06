import { EXTENSION_EVENTS } from '@malini/extension-api';

export type WorkstreamAutomationEvent =
	typeof EXTENSION_EVENTS.workstreamCreated | typeof EXTENSION_EVENTS.resourceReady;

export type CompiledWorkstreamAutomationTrigger = Readonly<{
	event: WorkstreamAutomationEvent;
	description: string;
	matches(payload: unknown): boolean;
}>;

export function compileWorkstreamAutomation(when: string): CompiledWorkstreamAutomationTrigger {
	const normalized = when
		.trim()
		.toLocaleLowerCase()
		.replaceAll(/[-_]+/gu, ' ')
		.replaceAll(/\s+/gu, ' ');
	if (
		/\b(?:new\s+)?workstream\b/u.test(normalized) &&
		/\b(?:create|created|creation)\b/u.test(normalized)
	) {
		return {
			event: EXTENSION_EVENTS.workstreamCreated,
			description: 'When this workstream is created',
			matches: () => true,
		};
	}
	const ready =
		/\b(?:boot|boots|booted|booting|ready|healthy|start|starts|started|starting|running|launch|launches|launched)\b/u.test(
			normalized,
		);
	const dockerOnly = /\b(?:docker|container)\b/u.test(normalized);
	const frontend = /\b(?:front end|frontend|web|client|ui)\b/u.test(normalized);
	const genericFrontendResource =
		frontend && /\b(?:resource|resources|service|services)\b/u.test(normalized);
	if (ready && (dockerOnly || genericFrontendResource)) {
		return {
			event: EXTENSION_EVENTS.resourceReady,
			description:
				dockerOnly && frontend
					? 'When a frontend Docker resource becomes ready'
					: dockerOnly
						? 'When a Docker resource becomes ready'
						: 'When a frontend resource becomes ready',
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
	throw new Error(
		`Unsupported extension automation trigger ${JSON.stringify(when)}. Try “when a new workstream is created”, “when a frontend resource becomes ready”, or “when a frontend Docker container becomes ready”.`,
	);
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
