export type ChatRequestId = string;

export type ChatRequestOutcome =
	| Readonly<{ status: 'pending' }>
	| Readonly<{ status: 'accepted' }>
	| Readonly<{ status: 'failed'; error: string }>;

export function newChatRequestId(): ChatRequestId {
	try {
		return globalThis.crypto.randomUUID();
	} catch {
		return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	}
}
