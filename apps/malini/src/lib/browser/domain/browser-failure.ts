export function browserFailure(action: string, error: unknown): string {
	const detail = error instanceof Error ? error.message.trim() : '';
	return detail ? `${action} · ${detail}` : action;
}
