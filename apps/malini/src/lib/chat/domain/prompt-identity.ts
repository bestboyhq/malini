export function newPromptRequestId(): string {
	try {
		return globalThis.crypto.randomUUID();
	} catch {
		return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	}
}
