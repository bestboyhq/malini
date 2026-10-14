import type { Repository } from '$shared/repositories/domain/repository';
import type { RepositoryImportSource } from '$shared/repositories/domain/github-auth';
import { captureRendererError } from '$shared/errors/renderer-error-sink';
import { githubService } from '$shared/repositories/infrastructure/services/github.service';

export const REPOSITORIES_POLL_INTERVAL_IDLE_MS = 30_000;
export const REPOSITORIES_POLL_INTERVAL_ACTIVE_MS = 5_000;

export class RepositoriesAggregate {
	items = $state<Repository[]>([]);
	hiddenIds = $state<ReadonlySet<string>>(new Set());
	loading = $state<boolean>(false);
	loaded = $state<boolean>(false);
	lastError = $state<string | null>(null);
	lastRefreshedAt = $state<string | null>(null);

	private refreshGeneration = 0;
	private readonly connecting = new Set<string>();

	async refresh(): Promise<void> {
		const generation = ++this.refreshGeneration;
		this.loading = true;
		try {
			const [list, hiddenIds] = await Promise.all([
				githubService.listRepositories(),
				githubService.listHiddenRepositoryIds(),
			]);
			if (generation !== this.refreshGeneration) return;
			this.items = sortByCreatedAtDesc(list.filter((repo) => !this.connecting.has(repo.id)));
			this.hiddenIds = new Set(hiddenIds);
			this.lastError = null;
			this.lastRefreshedAt = new Date().toISOString();
		} catch (err) {
			captureRendererError('caught', err);
			if (generation !== this.refreshGeneration) return;
			this.lastError = messageFromError(err);
		} finally {
			if (generation === this.refreshGeneration) {
				this.loading = false;
				this.loaded = true;
			}
		}
	}

	async connect(source: RepositoryImportSource): Promise<Repository> {
		const created = await githubService.connectRepository(source);
		this.connecting.add(created.id);
		return created;
	}

	reveal(id: string): void {
		this.connecting.delete(id);
	}

	async disconnect(id: string): Promise<'confirmed' | 'rolled-back'> {
		this.connecting.delete(id);
		const previousItems = this.items;
		const previousError = this.lastError;
		this.items = this.items.filter((existing) => existing.id !== id);
		this.lastError = null;

		try {
			await githubService.disconnectRepository(id);
			return 'confirmed';
		} catch (err) {
			captureRendererError('caught', err);
			this.items = previousItems;
			this.lastError = previousError ?? messageFromError(err);
			return 'rolled-back';
		}
	}

	async setHidden(id: string, hidden: boolean): Promise<void> {
		const previous = this.hiddenIds;
		const next = new Set(previous);
		if (hidden) next.add(id);
		else next.delete(id);
		this.hiddenIds = next;
		try {
			await githubService.setRepositoryHidden(id, hidden);
		} catch (err) {
			this.hiddenIds = previous;
			throw err;
		}
	}

	forget(id: string): void {
		this.items = this.items.filter((existing) => existing.id !== id);
		if (this.hiddenIds.has(id)) {
			this.hiddenIds = new Set([...this.hiddenIds].filter((hiddenId) => hiddenId !== id));
		}
	}

	reset(): void {
		this.refreshGeneration += 1;
		this.connecting.clear();
		this.items = [];
		this.hiddenIds = new Set();
		this.loading = false;
		this.loaded = false;
		this.lastError = null;
		this.lastRefreshedAt = null;
	}
}

export const repositoriesAggregate = new RepositoriesAggregate();

export function sortByCreatedAtDesc(items: readonly Repository[]): Repository[] {
	return [...items].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function messageFromError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
