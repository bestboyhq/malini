export type WorkstreamLifecycleAction = 'archived' | 'deleted';

export type WorkstreamLifecycleAnnouncer = (
	action: WorkstreamLifecycleAction,
	workstreamId: string,
) => void;

export type WorkstreamRetirementOutcome =
	Readonly<{ status: 'retired' }> | Readonly<{ status: 'failed'; message: string }>;

export function workstreamCount(count: number): string {
	return count === 1 ? '1 workstream' : `${count} workstreams`;
}

export function retirementFailureToast(
	action: 'archive' | 'delete' | 'remove' | 'restore' | 'hide' | 'unhide',
	workstreamName: string,
	reason: string,
): string {
	const sentence = reason.trim();
	return `Could not ${action} ${workstreamName} · ${/[.!?]$/u.test(sentence) ? sentence : `${sentence}.`}`;
}

export function retirementFailureMessage(cause: unknown): string {
	if (cause instanceof Error && cause.message.trim()) return cause.message;
	if (typeof cause === 'string' && cause.trim()) return cause;
	return 'The checkout could not be removed';
}
