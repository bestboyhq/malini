import {
	RECORDING_LEVEL_BARS,
	type SoundRecorderState,
	type SoundSignal,
} from '$shared/sounds/domain/sounds';

class SoundRecorderStore {
	state = $state<SoundRecorderState | null>(null);
	#stop: ((keep: boolean) => Promise<Blob | null>) | null = null;

	open(signal: SoundSignal): void {
		this.state = { signal, phase: 'asking', elapsedMs: 0, levels: [] };
	}

	answered(signal: SoundSignal, allowed: boolean): void {
		if (this.state?.signal !== signal || this.state.phase !== 'asking') return;
		this.state = { ...this.state, phase: allowed ? 'ready' : 'denied' };
	}

	recording(stop: (keep: boolean) => Promise<Blob | null>): void {
		this.#stop = stop;
		if (this.state) {
			this.state = {
				...this.state,
				phase: 'recording',
				elapsedMs: 0,
				levels: Array.from({ length: RECORDING_LEVEL_BARS }, () => 0),
			};
		}
	}

	heard(level: number, elapsedMs: number): void {
		if (this.state?.phase !== 'recording') return;
		this.state = { ...this.state, elapsedMs, levels: [...this.state.levels.slice(1), level] };
	}

	denied(): void {
		if (this.state) this.state = { ...this.state, phase: 'denied' };
	}

	takeStop(): ((keep: boolean) => Promise<Blob | null>) | null {
		const stop = this.#stop;
		this.#stop = null;
		return stop;
	}

	close(): void {
		this.state = null;
	}
}

export const soundRecorderStore = new SoundRecorderStore();
