import type { SessionId } from './session';

export type ClosedChat = Readonly<{
	id: SessionId;
	name: string;
	model: string | null;
	closedAt: string;
}>;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const RELATIVE_FORMAT = new Intl.RelativeTimeFormat('en', { style: 'narrow', numeric: 'auto' });

export function closedAgo(closedAt: string, nowMs: number): string {
	const elapsed = Math.max(0, nowMs - Date.parse(closedAt));
	if (elapsed < MINUTE_MS) return 'just now';
	if (elapsed < HOUR_MS) return RELATIVE_FORMAT.format(-Math.floor(elapsed / MINUTE_MS), 'minute');
	if (elapsed < DAY_MS) return RELATIVE_FORMAT.format(-Math.floor(elapsed / HOUR_MS), 'hour');
	return RELATIVE_FORMAT.format(-Math.floor(elapsed / DAY_MS), 'day');
}
