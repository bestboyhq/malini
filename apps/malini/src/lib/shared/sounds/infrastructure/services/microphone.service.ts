const LEVEL_GAIN = 2.5;

class MicrophoneService {
	async record(
		onLevel: (level: number, elapsedMs: number) => void,
	): Promise<(keep: boolean) => Promise<Blob | null>> {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		const context = new AudioContext();
		const analyser = context.createAnalyser();
		analyser.fftSize = 256;
		context.createMediaStreamSource(stream).connect(analyser);
		const samples = new Uint8Array(analyser.fftSize);
		const chunks: Blob[] = [];
		const recorder = new MediaRecorder(stream);
		const stopped = new Promise<void>((resolve) =>
			recorder.addEventListener('stop', () => resolve()),
		);
		recorder.addEventListener('dataavailable', (event) => chunks.push(event.data));
		const began = performance.now();
		let frame = 0;
		const measure = (): void => {
			analyser.getByteTimeDomainData(samples);
			let peak = 0;
			for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
			onLevel(Math.min(1, peak * LEVEL_GAIN), performance.now() - began);
			frame = requestAnimationFrame(measure);
		};
		recorder.start();
		frame = requestAnimationFrame(measure);

		return async (keep) => {
			cancelAnimationFrame(frame);
			if (recorder.state !== 'inactive') recorder.stop();
			await stopped;
			stream.getTracks().forEach((track) => track.stop());
			void context.close();
			return keep && chunks.length > 0 ? new Blob(chunks, { type: recorder.mimeType }) : null;
		};
	}
}

export const microphone = new MicrophoneService();
