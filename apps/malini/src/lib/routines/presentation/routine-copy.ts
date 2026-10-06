const TIMESTAMP_FORMAT = new Intl.DateTimeFormat(undefined, {
	month: 'short',
	day: 'numeric',
	hour: 'numeric',
	minute: '2-digit',
});

export function formatRoutineTimestamp(iso: string): string {
	const parsed = new Date(iso);
	return Number.isNaN(parsed.getTime()) ? iso : TIMESTAMP_FORMAT.format(parsed);
}
