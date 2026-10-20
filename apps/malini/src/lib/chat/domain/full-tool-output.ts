import type { SessionId } from './session';

export type FullToolOutput =
	| Readonly<{ status: 'loading' }>
	| Readonly<{ status: 'ready'; output: string | null }>
	| Readonly<{ status: 'failed'; error: string }>;

export function fullToolOutputKey(sessionId: SessionId, toolCallId: string): string {
	return `${sessionId}\u0000${toolCallId}`;
}
