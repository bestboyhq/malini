import type { CustomSound } from '$contract/sounds';
import type { LoadedSounds, SoundChoices, SoundSignal } from '$shared/sounds/domain/sounds';

class SoundsStore {
	choices = $state<SoundChoices | null>(null);
	custom = $state.raw<readonly CustomSound[]>([]);
	#urls = new Map<string, string>();

	loaded(sounds: LoadedSounds): void {
		this.choices = sounds.choices;
		this.custom = sounds.custom;
	}

	choose(signal: SoundSignal, id: string): void {
		if (this.choices) this.choices = { ...this.choices, [signal]: id };
	}

	add(sound: CustomSound, url: string): void {
		this.custom = [...this.custom, sound];
		this.#urls.set(sound.id, url);
	}

	remove(id: string): void {
		this.custom = this.custom.filter((sound) => sound.id !== id);
		const url = this.#urls.get(id);
		if (url) URL.revokeObjectURL(url);
		this.#urls.delete(id);
	}

	urlFor(id: string): string | undefined {
		return this.#urls.get(id);
	}

	keepUrl(id: string, url: string): void {
		this.#urls.set(id, url);
	}
}

export const soundsStore = new SoundsStore();
