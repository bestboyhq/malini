import { untrack } from 'svelte';
import {
	newChatRequestId,
	type ChatRequestId,
	type ChatRequestOutcome,
} from '$lib/chat/domain/chat-request';
import type { RenderItem, RunGroup } from '../render-state';
import { canonicalChangedPath, mutationRepresentedByTool } from '../run-timeline';

export type DestructiveConfirmState = 'idle' | 'submitting' | 'failed';

export const OPEN_RUN_BLOCKS_RESTORE = 'Finish the open run before rewinding this chat';

export type DestructiveRequest = {
	key: string;
	changeCount(): number;
	perform(requestId: ChatRequestId): void;
};

export type DestructiveConfirm = {
	readonly armedKey: string | null;
	readonly armedChangeCount: number;
	readonly state: DestructiveConfirmState;
	readonly error: string | null;
	readonly errorKey: string | null;
	isArmed(key: string | null | undefined): boolean;
	disarm(): void;
	reset(): void;
	confirm(request: DestructiveRequest): boolean;
};

type PerformedRequest = Readonly<{ key: string; requestId: ChatRequestId }>;

export function createDestructiveConfirm(input: {
	outcomeOf(requestId: ChatRequestId): ChatRequestOutcome | null;
	onAccepted?(key: string): void;
}): DestructiveConfirm {
	let armedKey = $state<string | null>(null);
	let armedChangeCount = $state(0);
	let performed = $state<PerformedRequest | null>(null);
	const outcome = $derived(performed ? input.outcomeOf(performed.requestId) : null);
	const state = $derived<DestructiveConfirmState>(
		outcome === null || outcome.status === 'accepted'
			? 'idle'
			: outcome.status === 'failed'
				? 'failed'
				: 'submitting',
	);
	const error = $derived(outcome?.status === 'failed' ? outcome.error : null);
	const inFlightKey = $derived(state === 'submitting' ? (performed?.key ?? null) : null);

	$effect(() => {
		const accepted = performed;
		if (!accepted || outcome?.status !== 'accepted') return;
		untrack(() => {
			performed = null;
			input.onAccepted?.(accepted.key);
		});
	});

	function disarm(): void {
		armedKey = null;
		armedChangeCount = 0;
	}

	function reset(): void {
		disarm();
		performed = null;
	}

	function confirm(request: DestructiveRequest): boolean {
		if (state === 'submitting') return false;

		if (armedKey !== request.key) {
			armedChangeCount = request.changeCount();
			armedKey = request.key;
			performed = null;
			return false;
		}

		const requestId = newChatRequestId();
		performed = { key: request.key, requestId };
		armedKey = null;
		request.perform(requestId);
		return true;
	}

	return {
		get armedKey(): string | null {
			return inFlightKey ?? armedKey;
		},
		get armedChangeCount(): number {
			return armedChangeCount;
		},
		get state(): DestructiveConfirmState {
			return state;
		},
		get error(): string | null {
			return error;
		},
		get errorKey(): string | null {
			return error === null ? null : (performed?.key ?? null);
		},
		isArmed: (key) => Boolean(key) && (inFlightKey ?? armedKey) === key,
		disarm,
		reset,
		confirm,
	};
}

export function collectChangedPaths(
	into: Set<string>,
	items: readonly RenderItem[],
	fromSeq: number,
): void {
	for (const candidate of items) {
		if (candidate.seq < fromSeq) continue;
		if (candidate.kind === 'file') {
			into.add(canonicalChangedPath(candidate.path));
			continue;
		}
		if (candidate.kind !== 'tool') continue;
		const mutated = mutationRepresentedByTool(candidate);
		if (mutated) into.add(canonicalChangedPath(mutated));
	}
}

export type CheckpointItem = Extract<RenderItem, { kind: 'user' }>;

export function fileChangesSinceCheckpoint(
	item: CheckpointItem,
	runs: readonly RunGroup[],
): number {
	const paths = new Set<string>();
	let reached = false;
	for (const run of runs) {
		const ownsItem = run.items.some((candidate) => candidate.key === item.key);
		if (ownsItem) reached = true;
		if (!reached) continue;
		if (run.superseded || run.obsoleted) continue;
		collectChangedPaths(paths, run.items, ownsItem ? item.seq : Number.NEGATIVE_INFINITY);
	}
	return paths.size;
}

export function runFileChanges(run: RunGroup): number {
	const paths = new Set<string>();
	collectChangedPaths(paths, run.items, Number.NEGATIVE_INFINITY);
	return paths.size;
}

export type RunUndoTarget = {
	checkpointId: string;
	changeCount: number;
};

export function runUndoTarget(run: RunGroup, runs: readonly RunGroup[]): RunUndoTarget | null {
	if (run.terminal === null) return null;
	if (run.obsoleted) return null;
	const opening = run.items.find((item) => item.kind === 'user');
	if (!opening || opening.kind !== 'user' || !opening.checkpointId) return null;
	if (runFileChanges(run) === 0) return null;
	return {
		checkpointId: opening.checkpointId,
		changeCount: fileChangesSinceCheckpoint(opening, runs),
	};
}

export function runUndoWarning(changeCount: number): string {
	return changeCount === 1
		? 'Discards 1 file change made since this turn, and every reply from this one on.'
		: `Discards ${changeCount} file changes made since this turn, and every reply from this one on.`;
}
