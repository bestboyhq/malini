import {
	RECORDING_LEVEL_BARS,
	type SoundRecorderState,
	type SoundSignal,
} from '$shared/sounds/domain/sounds';

type StopRecording = (keep: boolean) => Promise<Blob | null>;

class SoundRecorderStore {
	state = $state<SoundRecorderState | null>(null);
	#stop: StopRecording | null = null;
	#session = 0;

	open(signal: SoundSignal): void {
		this.#session += 1;
		this.state = { signal, phase: 'asking', elapsedMs: 0, levels: [] };
	}

	answered(signal: SoundSignal, allowed: boolean): void {
		if (this.state?.signal !== signal || this.state.phase !== 'asking') return;
		this.state = { ...this.state, phase: allowed ? 'ready' : 'denied' };
	}

	start(): number | null {
		if (this.state?.phase !== 'ready') return null;
		this.state = { ...this.state, phase: 'starting' };
		return this.#session;
	}

	recording(session: number, stop: StopRecording): boolean {
		if (session !== this.#session || this.state?.phase !== 'starting') return false;
		this.#stop = stop;
		this.state = {
			...this.state,
			phase: 'recording',
			elapsedMs: 0,
			levels: Array.from({ length: RECORDING_LEVEL_BARS }, () => 0),
		};
		return true;
	}

	heard(session: number, level: number, elapsedMs: number): boolean {
		if (session !== this.#session || this.state?.phase !== 'recording') return false;
		this.state = { ...this.state, elapsedMs, levels: [...this.state.levels.slice(1), level] };
		return true;
	}

	denied(session: number): void {
		if (session === this.#session && this.state) this.state = { ...this.state, phase: 'denied' };
	}

	takeStop(): StopRecording | null {
		const stop = this.#stop;
		this.#stop = null;
		return stop;
	}

	close(): void {
		this.#session += 1;
		this.state = null;
	}
}

export const soundRecorderStore = new SoundRecorderStore();
