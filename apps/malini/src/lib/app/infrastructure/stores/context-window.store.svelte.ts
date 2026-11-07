class ContextWindowStore {
	tokens = $state<number | null>(null);
	optimized = $state<boolean | null>(null);

	replace(tokens: number): void {
		this.tokens = tokens;
	}

	optimize(optimized: boolean): void {
		this.optimized = optimized;
	}
}

export const contextWindowStore = new ContextWindowStore();
