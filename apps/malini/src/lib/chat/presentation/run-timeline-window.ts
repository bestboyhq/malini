import type { RunTimelineItem } from './run-timeline';

export type RunTimelineWindow = {
	items: RunTimelineItem[];
	hiddenCount: number;
};

export function windowRunTimeline(
	items: readonly RunTimelineItem[],
	limit: number,
): RunTimelineWindow {
	const safeLimit = Math.max(1, Math.floor(limit));
	if (items.length <= safeLimit) return { items: [...items], hiddenCount: 0 };

	const firstUser = items.find((item) => item.kind === 'user');
	const tail = items.slice(-safeLimit);
	if (!firstUser || tail.some((item) => item.key === firstUser.key)) {
		return { items: tail, hiddenCount: items.length - tail.length };
	}

	const preserved = safeLimit === 1 ? [firstUser] : [firstUser, ...items.slice(-(safeLimit - 1))];
	return { items: preserved, hiddenCount: items.length - preserved.length };
}
