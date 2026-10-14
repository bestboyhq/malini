const NOTES_HZ = [659.25, 987.77] as const;
const NOTE_GAP_SECONDS = 0.11;
const NOTE_SECONDS = 0.7;
const PEAK_GAIN = 0.08;

let context: AudioContext | null = null;

export function chime(): void {
	if (typeof AudioContext === 'undefined') return;
	context ??= new AudioContext();
	void context.resume();
	const start = context.currentTime;
	NOTES_HZ.forEach((frequency, index) => {
		if (!context) return;
		const at = start + index * NOTE_GAP_SECONDS;
		const oscillator = context.createOscillator();
		const gain = context.createGain();
		oscillator.type = 'sine';
		oscillator.frequency.value = frequency;
		gain.gain.setValueAtTime(0, at);
		gain.gain.linearRampToValueAtTime(PEAK_GAIN, at + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_SECONDS);
		oscillator.connect(gain).connect(context.destination);
		oscillator.start(at);
		oscillator.stop(at + NOTE_SECONDS);
	});
}
