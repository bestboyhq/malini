import type { ChatTurnRecord } from '$contract/jobs';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';

const RELOAD_DELAY_MS = 300;

class ChatTurnsAggregate {
	turns = $state.raw<readonly ChatTurnRecord[]>([]);
	every = $state(false);

	#loaded = false;
	#generation = 0;
	#reload: ReturnType<typeof setTimeout> | null = null;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		const turns = await jobsService.listChatTurns(this.every);
		if (generation !== this.#generation) return;
		this.#loaded = true;
		this.turns = turns;
	}

	include(runId: string): void {
		if (this.#loaded && !this.#knows(runId)) this.#reloadSoon();
	}

	refresh(runId: string): void {
		if (this.#loaded && (this.every || this.#knows(runId))) this.#reloadSoon();
	}

	#knows(runId: string): boolean {
		return this.turns.some((turn) => turn.runId === runId);
	}

	#reloadSoon(): void {
		if (this.#reload) clearTimeout(this.#reload);
		this.#reload = setTimeout(() => {
			this.#reload = null;
			void this.load().catch(() => undefined);
		}, RELOAD_DELAY_MS);
	}
}

export const chatTurnsAggregate = new ChatTurnsAggregate();
