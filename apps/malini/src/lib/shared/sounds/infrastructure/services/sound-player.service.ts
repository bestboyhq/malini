class SoundPlayerService {
	play(url: string): void {
		if (typeof Audio === 'undefined') return;
		void new Audio(url).play().catch(() => undefined);
	}
}

export const soundPlayer = new SoundPlayerService();
