export type ScratchpadState =
	| Readonly<{ status: 'loading' }>
	| Readonly<{ status: 'ready'; content: string | null }>
	| Readonly<{ status: 'failed'; error: string }>;

export type ScratchpadStart = Readonly<{ prompt: string; onStarted: () => void }>;

export function scratchpadKey(repositoryFullName: string): string {
	return repositoryFullName.trim().toLowerCase();
}

export function isScratchpadContent(content: string): boolean {
	try {
		const value: unknown = JSON.parse(content);
		return (
			typeof value === 'object' &&
			value !== null &&
			!Array.isArray(value) &&
			Reflect.get(value, 'type') === 'doc'
		);
	} catch {
		return false;
	}
}

export function ideasLabel(count: number): string {
	return `${count} ${count === 1 ? 'idea' : 'ideas'}`;
}
