import type { AgentPermissionDescriptor } from './agent-interaction';

const TARGET_KINDS = new Set(['path', 'command', 'url']);

export function approvalHeadline(
	toolName: string | undefined,
	permission: AgentPermissionDescriptor | undefined,
): string {
	const resources = permission?.resources ?? [];
	const files = resources.filter((resource) => resource.kind === 'path').length > 1;
	const fileNoun = files ? 'files' : 'a file';
	const tool = toolName ?? 'a tool';
	if (permission?.capability === 'read') return `Claude wants to read ${fileNoun}`;
	if (permission?.capability === 'write') return `Claude wants to edit ${fileNoun}`;
	if (permission?.capability === 'network') {
		if (toolName === 'WebSearch') return 'Claude wants to search the web';
		if (toolName === 'WebFetch') return 'Claude wants to fetch a web page';
		return 'Claude wants to reach the network';
	}
	if (permission?.capability === 'external-service') {
		const service = resources.find((resource) => resource.kind === 'service')?.value;
		return `Claude wants to use ${service ?? tool}`;
	}
	if (resources.some((resource) => resource.kind === 'command')) {
		return 'Claude wants to run a command';
	}
	return `Claude wants to use ${tool}`;
}

export function approvalTargets(permission: AgentPermissionDescriptor | undefined): string[] {
	return (permission?.resources ?? [])
		.filter((resource) => TARGET_KINDS.has(resource.kind) && resource.value.trim())
		.map((resource) => resource.canonicalValue ?? resource.value);
}

export function approvalShortTarget(
	toolName: string | undefined,
	permission: AgentPermissionDescriptor | undefined,
): string {
	const resource = (permission?.resources ?? []).find(
		(candidate) => TARGET_KINDS.has(candidate.kind) && candidate.value.trim(),
	);
	if (!resource) return toolName ?? 'tool';
	if (resource.kind !== 'path') return resource.value;
	return resource.value.split('/').filter(Boolean).at(-1) ?? resource.value;
}

export function approvalReason(reason: string): string | null {
	const trimmed = reason.trim();
	return trimmed && !trimmed.startsWith('Claude wants to') ? trimmed : null;
}
