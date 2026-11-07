import type { BrainEntry, BrainStatus } from '$contract/brain';
import type { BrainDocumentState } from '$lib/brain/domain/brain';
import { brainService } from '$lib/brain/infrastructure/services/brain.service';

class BrainAggregate {
	status = $state.raw<BrainStatus | null>(null);
	entries = $state.raw<readonly BrainEntry[] | null>(null);
	documents = $state.raw<Readonly<Record<string, BrainDocumentState>>>({});
	settingUp = $state(false);
	syncing = $state(false);

	documentOf(path: string): BrainDocumentState | null {
		return this.documents[path] ?? null;
	}

	async refresh(status?: BrainStatus): Promise<void> {
		this.status = status ?? (await brainService.status());
		this.entries = this.status.set ? await brainService.list() : [];
		const shown = Object.keys(this.documents).filter(
			(path) => this.documents[path]?.status !== 'loading',
		);
		await Promise.all(shown.map((path) => this.read(path)));
	}

	async read(path: string): Promise<void> {
		if (this.documentOf(path) === null) this.#setDocument(path, { status: 'loading' });
		try {
			this.#setDocument(path, { status: 'ready', document: await brainService.read(path) });
		} catch (error) {
			this.#setDocument(path, {
				status: 'failed',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	#setDocument(path: string, state: BrainDocumentState): void {
		this.documents = { ...this.documents, [path]: state };
	}
}

export const brainAggregate = new BrainAggregate();
