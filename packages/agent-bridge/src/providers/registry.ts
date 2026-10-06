import type {
	ProviderContext,
	ProviderEventListener,
	ProviderFactory,
	ProviderHandle,
} from './types.js';

export class UnknownProviderError extends Error {
	constructor() {
		super('UNKNOWN_PROVIDER: no agent factory is registered');
		this.name = 'UnknownProviderError';
	}
}

export class ProviderRegistry {
	private factory: ProviderFactory | null = null;

	setProvider(factory: ProviderFactory): void {
		this.factory = factory;
	}

	hasProvider(): boolean {
		return this.factory !== null;
	}

	async getProvider(ctx: ProviderContext, emit: ProviderEventListener): Promise<ProviderHandle> {
		const factory = this.factory;
		if (!factory) throw new UnknownProviderError();
		return factory(ctx, emit);
	}

	clear(): void {
		this.factory = null;
	}
}

export const defaultProviderRegistry = new ProviderRegistry();
