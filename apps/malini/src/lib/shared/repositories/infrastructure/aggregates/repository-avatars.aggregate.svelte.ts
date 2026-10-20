import { repositoryAvatarsService } from '$shared/repositories/infrastructure/services/repository-avatars.service';

const MISSING = 'missing';

class RepositoryAvatarsAggregate {
	entries: Readonly<Record<string, string>> = $state({});

	readonly #inflight = new Set<string>();

	urlFor(owner: string): string | null {
		const entry = this.entries[owner];
		return entry === undefined || entry === MISSING ? null : entry;
	}

	async load(owner: string): Promise<void> {
		if (this.entries[owner] !== undefined || this.#inflight.has(owner)) return;
		this.#inflight.add(owner);
		try {
			const url = await repositoryAvatarsService.ownerAvatarUrl(owner);
			this.#write(owner, url ?? MISSING);
		} catch {
			this.#write(owner, MISSING);
		} finally {
			this.#inflight.delete(owner);
		}
	}

	reset(): void {
		this.entries = {};
		this.#inflight.clear();
	}

	#write(owner: string, entry: string): void {
		this.entries = { ...this.entries, [owner]: entry };
	}
}

export const repositoryAvatarsAggregate = new RepositoryAvatarsAggregate();
