import type { Workstream } from './workstream';

export type ExtensionWorkstreamSummary = Readonly<{
	id: string;
	name: string;
	branch: string;
}>;

export function listExtensionWorkstreamsForAnchor(
	anchorWorkstreamId: string | undefined,
	workstreams: readonly Workstream[],
): readonly ExtensionWorkstreamSummary[] {
	const projectId = activeAnchorProjectId(anchorWorkstreamId, workstreams);
	return workstreams
		.filter(({ projectId: candidateProjectId, status }) => {
			return candidateProjectId === projectId && status !== 'archived';
		})
		.map(({ id, name, branch }) => ({ id, name, branch }));
}

export function requireExtensionWorkstreamForAnchor(
	workstreamId: string,
	anchorWorkstreamId: string | undefined,
	workstreams: readonly Workstream[],
): Workstream {
	const projectId = activeAnchorProjectId(anchorWorkstreamId, workstreams);
	const workstream = workstreams.find(
		({ id, projectId: candidateProjectId, status }) =>
			id === workstreamId && candidateProjectId === projectId && status !== 'archived',
	);
	if (!workstream) {
		throw new Error(`Unknown workstream for the active repository: ${workstreamId}`);
	}
	return workstream;
}

export function extensionWorkstreamSummary(workstream: Workstream): ExtensionWorkstreamSummary {
	return { id: workstream.id, name: workstream.name, branch: workstream.branch };
}

export function requiredExtensionText(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} cannot be empty`);
	return value.trim();
}

export function optionalExtensionText<Key extends 'title' | 'url'>(
	key: Key,
	value: string | undefined,
): Partial<Record<Key, string>> {
	const normalized = value?.trim();
	const result: Partial<Record<Key, string>> = {};
	if (normalized) result[key] = normalized;
	return result;
}

function activeAnchorProjectId(
	anchorWorkstreamId: string | undefined,
	workstreams: readonly Workstream[],
): string {
	const normalizedAnchorId = anchorWorkstreamId?.trim();
	if (!normalizedAnchorId) {
		throw new Error('Workstream navigation requires an active workstream');
	}
	const anchor = workstreams.find(
		({ id, status }) => id === normalizedAnchorId && status !== 'archived',
	);
	if (!anchor) throw new Error('The active workstream is no longer available');
	return anchor.projectId;
}
