import chimeUrl from './chime.wav';

let sound: HTMLAudioElement | null = null;

export function chime(): void {
	if (typeof Audio === 'undefined') return;
	sound ??= new Audio(chimeUrl);
	sound.currentTime = 0;
	void sound.play().catch(() => undefined);
}
