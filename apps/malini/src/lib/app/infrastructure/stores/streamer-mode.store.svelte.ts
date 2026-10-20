import { sensitiveMasking } from '$hyper-ui/components/sensitive';
import {
	masksPersonalData,
	parseStreamerMode,
	type StreamerMode,
} from '$lib/app/domain/streamer-mode';

const STREAMER_MODE_KEY = 'malini.settings.streamer-mode';

class StreamerModeStore {
	#mode: StreamerMode = $state('auto');
	#streaming: boolean = $state(false);

	get mode(): StreamerMode {
		return this.#mode;
	}

	get streaming(): boolean {
		return this.#streaming;
	}

	hydrate(): void {
		this.#mode = parseStreamerMode(read());
		this.#apply();
	}

	choose(mode: StreamerMode): void {
		this.#mode = mode;
		write(mode);
		this.#apply();
	}

	observeStreaming(streaming: boolean): void {
		this.#streaming = streaming;
		this.#apply();
	}

	#apply(): void {
		sensitiveMasking.on = masksPersonalData(this.#mode, this.#streaming);
	}
}

function read(): string | null {
	try {
		return globalThis.localStorage?.getItem(STREAMER_MODE_KEY) ?? null;
	} catch {
		return null;
	}
}

function write(mode: StreamerMode): void {
	try {
		globalThis.localStorage?.setItem(STREAMER_MODE_KEY, mode);
	} catch {}
}

export const streamerModeStore = new StreamerModeStore();
