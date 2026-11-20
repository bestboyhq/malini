import type { Initiative } from '$lib/initiatives/domain/initiative';

class InitiativesAggregate {
	list = $state.raw<readonly Initiative[]>([]);
	loaded = $state.raw<boolean>(false);
	error = $state.raw<string | null>(null);

	set(list: readonly Initiative[]): void {
		this.list = list;
		this.loaded = true;
		this.error = null;
	}

	fail(error: string): void {
		this.error = error;
	}

	clearError(): void {
		this.error = null;
	}
}

export const initiativesAggregate = new InitiativesAggregate();
