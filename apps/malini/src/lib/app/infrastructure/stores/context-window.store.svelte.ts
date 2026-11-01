class ContextWindowStore {
	tokens = $state<number | null>(null);

	replace(tokens: number): void {
		this.tokens = tokens;
	}
}

export const contextWindowStore = new ContextWindowStore();
