import { scratchpadKey } from '$lib/scratchpad/domain/scratchpad';

type ScratchpadWrite = Readonly<{ repositoryFullName: string; content: string }>;

class ScratchpadWritesStore {
	readonly #pending = new Map<string, ScratchpadWrite>();
	readonly #writing = new Set<string>();
	readonly #failing = new Set<string>();

	queue(write: ScratchpadWrite): boolean {
		const key = scratchpadKey(write.repositoryFullName);
		this.#pending.set(key, write);
		if (this.#writing.has(key)) return false;
		this.#writing.add(key);
		return true;
	}

	take(repositoryFullName: string): ScratchpadWrite | null {
		const key = scratchpadKey(repositoryFullName);
		const write = this.#pending.get(key) ?? null;
		this.#pending.delete(key);
		if (write === null) this.#writing.delete(key);
		return write;
	}

	fail(repositoryFullName: string): boolean {
		const key = scratchpadKey(repositoryFullName);
		if (this.#failing.has(key)) return false;
		this.#failing.add(key);
		return true;
	}

	recover(repositoryFullName: string): void {
		this.#failing.delete(scratchpadKey(repositoryFullName));
	}
}

export const scratchpadWritesStore = new ScratchpadWritesStore();
