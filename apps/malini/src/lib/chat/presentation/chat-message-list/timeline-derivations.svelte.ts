import { foldRunWork, groupRunTimeline, type GroupedRunTimelineItem } from '../activity-group';
import { runProjectionVersion } from '../render-projector';
import type { RunGroup } from '../render-state';
import type { RunTimelineItem } from '../run-timeline';
import type { FinalizedStreamingThought } from '$lib/chat/domain/streaming-block';

export const UNFOLDED_ROUNDS = 2;

export function foldsWork(runs: readonly RunGroup[], index: number): boolean {
	return index < runs.length - UNFOLDED_ROUNDS && runs[index]?.terminal !== null;
}

const EMPTY_TIMELINE: readonly RunTimelineItem[] = [];

type TimelineDerivation = {
	version: number;
	thoughts: readonly FinalizedStreamingThought[];
	length: number;
	grouped: readonly GroupedRunTimelineItem[] | null;
	folded: readonly GroupedRunTimelineItem[] | null;
};

export type TimelineDerivations = {
	timelineItems(run: RunGroup): RunTimelineItem[];
	groupedTimelineItems(
		run: RunGroup,
		folded: boolean,
		replying?: boolean,
	): readonly GroupedRunTimelineItem[];
};

export function createTimelineDerivations(input: {
	runs(): readonly RunGroup[];
	projectRun(run: RunGroup): RunTimelineItem[];
	retainRuns(runIds: Set<string>): void;
	thoughtsForRun(runId: string): readonly FinalizedStreamingThought[];
}): TimelineDerivations {
	const { runs, projectRun, retainRuns, thoughtsForRun } = input;
	const timelineDerivations = new Map<string, TimelineDerivation>();

	const timelineByRun = $derived.by(() => {
		const timelines = new Map<string, RunTimelineItem[]>();
		const currentRuns = runs();
		for (const run of currentRuns) {
			timelines.set(run.runId, projectRun(run));
		}
		retainRuns(new Set(currentRuns.map((run) => run.runId)));
		for (const runId of timelineDerivations.keys()) {
			if (!timelines.has(runId)) timelineDerivations.delete(runId);
		}
		return timelines;
	});

	function derivationFor(run: RunGroup): TimelineDerivation | null {
		const version = runProjectionVersion(run);
		if (version === null) return null;
		const items = timelineByRun.get(run.runId) ?? EMPTY_TIMELINE;
		const thoughts = thoughtsForRun(run.runId);
		const cached = timelineDerivations.get(run.runId);
		if (
			cached &&
			cached.version === version &&
			cached.thoughts === thoughts &&
			cached.length === items.length
		) {
			return cached;
		}
		const fresh: TimelineDerivation = {
			version,
			thoughts,
			length: items.length,
			grouped: null,
			folded: null,
		};
		timelineDerivations.set(run.runId, fresh);
		return fresh;
	}

	return {
		timelineItems(run: RunGroup): RunTimelineItem[] {
			return timelineByRun.get(run.runId) ?? [];
		},

		groupedTimelineItems(
			run: RunGroup,
			folded: boolean,
			replying = false,
		): readonly GroupedRunTimelineItem[] {
			const items = timelineByRun.get(run.runId) ?? EMPTY_TIMELINE;
			if (run.terminal === null && !run.turnEnded) return groupRunTimeline(items, !replying);
			const derivation = derivationFor(run);
			if (!derivation) {
				const grouped = groupRunTimeline(items);
				return folded ? foldRunWork(grouped) : grouped;
			}
			derivation.grouped ??= groupRunTimeline(items);
			if (!folded) return derivation.grouped;
			derivation.folded ??= foldRunWork(derivation.grouped);
			return derivation.folded;
		},
	};
}
