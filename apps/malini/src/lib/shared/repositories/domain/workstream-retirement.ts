export const WORKSTREAM_UNDO_WINDOW_MS = 5000;

export type WorkstreamLifecycleAction = 'archived' | 'deleted';

export type WorkstreamLifecycleAnnouncer = (
	action: WorkstreamLifecycleAction,
	workstreamId: string,
) => void;

export type WorkstreamRetirementOutcome =
	| Readonly<{ status: 'retired' }>
	| Readonly<{ status: 'undone' }>
	| Readonly<{ status: 'failed'; message: string }>;

export type SavedWorkstreamWork = Readonly<{
	ref: string;
	uncommitted: boolean;
	commits: number;
}>;

export function savedWorkNote(saved: SavedWorkstreamWork): string {
	const commits = saved.commits === 1 ? 'commit' : `${saved.commits} commits`;
	if (saved.uncommitted && saved.commits > 0) {
		return `Its ${commits} and uncommitted work are saved`;
	}
	if (saved.uncommitted) {
		return 'Its uncommitted work is saved';
	}
	return `Its ${commits} ${saved.commits === 1 ? 'is' : 'are'} saved`;
}

export function workstreamCount(count: number): string {
	return count === 1 ? '1 workstream' : `${count} workstreams`;
}

export function retirementFailureToast(
	action: 'archive' | 'delete' | 'remove',
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
