import { groupRunTimeline, type GroupedRunTimelineItem } from '../activity-group';
import { runProjectionVersion } from '../render-projector';
import type { RunGroup } from '../render-state';
import type { RunTimelineItem } from '../run-timeline';
import { windowRunTimeline, type RunTimelineWindow } from '../run-timeline-window';
import type { FinalizedStreamingThought } from '$lib/chat/domain/streaming-block';

export const INITIAL_RUN_TIMELINE_WINDOW_SIZE = 200;
export const RUN_TIMELINE_REVEAL_INCREMENT = 200;

const EMPTY_TIMELINE: readonly RunTimelineItem[] = [];
const EMPTY_WINDOW: RunTimelineWindow = { items: [], hiddenCount: 0 };

type TimelineDerivation = {
	version: number;
	thoughts: readonly FinalizedStreamingThought[];
	length: number;
	limit: number;
	window: RunTimelineWindow;
	grouped: readonly GroupedRunTimelineItem[] | null;
};

export type TimelineDerivations = {
	timelineItems(run: RunGroup): RunTimelineItem[];
	timelineWindow(run: RunGroup): RunTimelineWindow;
	groupedTimelineItems(
		run: RunGroup,
		window: RunTimelineWindow,
		isLastRun: boolean,
	): readonly GroupedRunTimelineItem[];
	revealOlderTimeline(runId: string): void;
};

export function createTimelineDerivations(input: {
	runs(): readonly RunGroup[];
	projectRun(run: RunGroup): RunTimelineItem[];
	retainRuns(runIds: Set<string>): void;
	thoughtsForRun(runId: string): readonly FinalizedStreamingThought[];
}): TimelineDerivations {
	const { runs, projectRun, retainRuns, thoughtsForRun } = input;
	let visibleTimelineLimitByRun = $state<Record<string, number>>({});
	const timelineDerivations = new Map<string, TimelineDerivation>();

	const timelineByRun = $derived.by(() => {
		const timelines = new Map<string, RunTimelineItem[]>();
		const currentRuns = runs();
		for (const run of currentRuns) {
			timelines.set(run.runId, projectRun(run));
		}
		retainRuns(new Set(currentRuns.map((run) => run.runId)));
		return timelines;
	});

	function derivationFor(run: RunGroup): TimelineDerivation | null {
		const version = runProjectionVersion(run);
		if (version === null) return null;
		const items = timelineByRun.get(run.runId) ?? EMPTY_TIMELINE;
		const thoughts = thoughtsForRun(run.runId);
		const limit = visibleTimelineLimitByRun[run.runId] ?? INITIAL_RUN_TIMELINE_WINDOW_SIZE;
		const cached = timelineDerivations.get(run.runId);
		if (
			cached &&
			cached.version === version &&
			cached.thoughts === thoughts &&
			cached.length === items.length &&
			cached.limit === limit
		) {
			return cached;
		}
		const fresh: TimelineDerivation = {
			version,
			thoughts,
			length: items.length,
			limit,
			window: windowRunTimeline(items, limit),
			grouped: null,
		};
		timelineDerivations.set(run.runId, fresh);
		return fresh;
	}

	const timelineWindowByRun = $derived.by(() => {
		const windows = new Map<string, RunTimelineWindow>();
		for (const run of runs()) {
			const derivation = derivationFor(run);
			windows.set(
				run.runId,
				derivation?.window ??
					windowRunTimeline(
						timelineByRun.get(run.runId) ?? EMPTY_TIMELINE,
						visibleTimelineLimitByRun[run.runId] ?? INITIAL_RUN_TIMELINE_WINDOW_SIZE,
					),
			);
		}
		for (const runId of timelineDerivations.keys()) {
			if (!windows.has(runId)) timelineDerivations.delete(runId);
		}
		return windows;
	});

	return {
		timelineItems(run: RunGroup): RunTimelineItem[] {
			return timelineByRun.get(run.runId) ?? [];
		},

		timelineWindow(run: RunGroup): RunTimelineWindow {
			return timelineWindowByRun.get(run.runId) ?? EMPTY_WINDOW;
		},

		groupedTimelineItems(
			run: RunGroup,
			window: RunTimelineWindow,
			isLastRun: boolean,
		): readonly GroupedRunTimelineItem[] {
			if (isLastRun) return window.items;
			const derivation = derivationFor(run);
			if (!derivation) return groupRunTimeline(window.items);
			derivation.grouped ??= groupRunTimeline(window.items);
			return derivation.grouped;
		},

		revealOlderTimeline(runId: string): void {
			visibleTimelineLimitByRun = {
				...visibleTimelineLimitByRun,
				[runId]:
					(visibleTimelineLimitByRun[runId] ?? INITIAL_RUN_TIMELINE_WINDOW_SIZE) +
					RUN_TIMELINE_REVEAL_INCREMENT,
			};
		},
	};
}
