export type WorkstreamActionKind = 'commit' | 'delete';

export function workstreamActionFailureMessage(cause: unknown, fallback: string): string {
	if (cause instanceof Error && cause.message.trim()) return cause.message;
	if (typeof cause === 'string' && cause.trim()) return cause;
	return fallback;
}
