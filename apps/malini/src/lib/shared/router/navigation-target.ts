import type { NavigationTarget } from './hash-router.svelte';

export function navigationTargetsWorkstream(
	target: NavigationTarget | null,
	workstreamId: string,
): boolean {
	if (target === null) return true;
	return target.params.workstreamId === workstreamId;
}

export function openingWorkstreamId(
	target: NavigationTarget | null,
	activeWorkstreamId: string,
): string | null {
	const pending = target?.params.workstreamId;
	if (!pending || pending === activeWorkstreamId) return null;
	return pending;
}
