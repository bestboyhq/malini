import type { RenderItem, RunGroup } from './render-state';
import {
	linearizeRunTimeline,
	commandRepresentedByTool,
	mutationRepresentedByTool,
	representedBridgeEvents,
	ChangedPathSet,
	type RunTimelineItem,
	type RunTimelineThought,
} from './run-timeline';
import {
	runProjectionChangesSince,
	runProjectionVersion,
	type RunProjectionChange,
} from './render-projector';

type TimelineState = {
	run: RunGroup;
	version: number;
	items: RunTimelineItem[];
	indexByKey: Map<string, number>;
	commands: Set<string>;
	mutations: ChangedPathSet;
	thoughtSignatureByKey: Map<string, string>;
};

export type IncrementalRunTimelineStats = {
	processedChanges: number;
	rebuildCount: number;
};

function thoughtItem(runId: string, thought: RunTimelineThought): RunTimelineItem {
	return {
		...thought,
		kind: 'thought',
		key: `thought-${runId}-${thought.contentId}`,
	};
}

function thoughtSignature(thought: RunTimelineThought): string {
	return `${thought.seq}:${thought.durationSeconds ?? ''}:${thought.text}`;
}

function excluded(item: RenderItem): item is Extract<RenderItem, { kind: 'terminal' | 'usage' }> {
	return item.kind === 'terminal' || item.kind === 'usage';
}

export class IncrementalRunTimelineProjector {
	#states = new Map<string, TimelineState>();
	#processedChanges = 0;
	#rebuildCount = 0;

	project(run: RunGroup, thoughts: readonly RunTimelineThought[]): RunTimelineItem[] {
		let state = this.#states.get(run.runId);
		if (!state || state.run !== run) {
			state = this.#rebuild(run, thoughts);
			return state.items;
		}

		const delta = runProjectionChangesSince(run, state.version);
		if (!delta) {
			state = this.#rebuild(run, thoughts);
			return state.items;
		}
		for (const change of delta.changes) {
			if (!this.#applyChange(state, change)) {
				state = this.#rebuild(run, thoughts);
				return state.items;
			}
			this.#processedChanges += 1;
		}
		state.version = delta.version;
		if (!this.#syncThoughts(state, thoughts)) {
			state = this.#rebuild(run, thoughts);
		}
		return state.items;
	}

	retainRuns(runIds: ReadonlySet<string>): void {
		for (const runId of this.#states.keys()) {
			if (!runIds.has(runId)) this.#states.delete(runId);
		}
	}

	reset(): void {
		this.#states.clear();
	}

	stats(): IncrementalRunTimelineStats {
		return { processedChanges: this.#processedChanges, rebuildCount: this.#rebuildCount };
	}

	#rebuild(run: RunGroup, thoughts: readonly RunTimelineThought[]): TimelineState {
		const represented = representedBridgeEvents(run);
		const items = linearizeRunTimeline(run, thoughts);
		const state: TimelineState = {
			run,
			version: runProjectionVersion(run) ?? 0,
			items,
			indexByKey: new Map(),
			commands: new Set(represented.commands),
			mutations: represented.mutations,
			thoughtSignatureByKey: new Map(
				thoughts.map((thought) => [
					`thought-${run.runId}-${thought.contentId}`,
					thoughtSignature(thought),
				]),
			),
		};
		this.#reindex(state);
		this.#states.set(run.runId, state);
		this.#rebuildCount += 1;
		return state;
	}

	#applyChange(state: TimelineState, change: RunProjectionChange): boolean {
		if (change.kind === 'remove') return false;
		if (change.kind === 'replace') {
			const index = state.indexByKey.get(change.previous.key);
			if (index === undefined) return true;
			if (change.previous.key !== change.item.key || excluded(change.item)) return false;
			state.items[index] = change.item;
			return true;
		}

		const item = change.item;
		if (excluded(item)) return true;
		if (item.kind === 'tool') {
			const command = commandRepresentedByTool(item);
			if (command && !state.commands.has(command)) {
				state.commands.add(command);
				this.#removeMatching(
					state,
					(candidate) => candidate.kind === 'command' && candidate.command.trim() === command,
				);
			}
			const mutation = mutationRepresentedByTool(item);
			if (mutation) state.mutations.add(mutation, item.seq);
		} else if (item.kind === 'command' && state.commands.has(item.command.trim())) {
			return true;
		} else if (item.kind === 'file' && state.mutations.has(item.path, item.seq)) {
			return true;
		}
		this.#insertCanonical(state, item);
		return true;
	}

	#syncThoughts(state: TimelineState, thoughts: readonly RunTimelineThought[]): boolean {
		const currentKeys = new Set<string>();
		for (const thought of thoughts) {
			const item = thoughtItem(state.run.runId, thought);
			currentKeys.add(item.key);
			const signature = thoughtSignature(thought);
			const previous = state.thoughtSignatureByKey.get(item.key);
			if (previous === signature) continue;
			if (previous !== undefined) return false;
			state.thoughtSignatureByKey.set(item.key, signature);
			this.#insertCanonical(state, item);
		}
		for (const key of state.thoughtSignatureByKey.keys()) {
			if (!currentKeys.has(key)) return false;
		}
		return true;
	}

	#insertCanonical(state: TimelineState, item: RunTimelineItem): void {
		let low = 0;
		let high = state.items.length;
		while (low < high) {
			const middle = low + Math.floor((high - low) / 2);
			const candidate = state.items[middle];
			if (
				candidate === undefined ||
				candidate.seq < item.seq ||
				(candidate.seq === item.seq && candidate.key < item.key)
			) {
				low = middle + 1;
			} else {
				high = middle;
			}
		}
		state.items.splice(low, 0, item);
		this.#reindex(state, low);
	}

	#removeMatching(state: TimelineState, predicate: (item: RunTimelineItem) => boolean): void {
		const next = state.items.filter((item) => !predicate(item));
		if (next.length === state.items.length) return;
		state.items.splice(0, state.items.length, ...next);
		this.#reindex(state);
	}

	#reindex(state: TimelineState, start = 0): void {
		if (start === 0) state.indexByKey.clear();
		for (let index = start; index < state.items.length; index += 1) {
			const item = state.items[index];
			if (item) state.indexByKey.set(item.key, index);
		}
	}
}
