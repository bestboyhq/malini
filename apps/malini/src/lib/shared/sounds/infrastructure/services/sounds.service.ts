import type { CustomSound, CustomSoundKind } from '$contract/sounds';
import { invoke } from '$shared/port/invoke';
import {
	soundChoices,
	soundSettingKey,
	type LoadedSounds,
	type SoundSignal,
} from '$shared/sounds/domain/sounds';

class SoundsService {
	async load(): Promise<LoadedSounds> {
		const [settings, custom] = await Promise.all([
			invoke('app.list-settings', undefined),
			invoke('sounds.list', undefined),
		]);
		return { choices: soundChoices(settings), custom };
	}

	choose(signal: SoundSignal, id: string): Promise<void> {
		return invoke('app.set-setting', { key: soundSettingKey(signal), value: id });
	}

	async customSoundUrl(id: string): Promise<string> {
		const sound = await invoke('sounds.read', { id });
		return URL.createObjectURL(new Blob([sound.bytes], { type: sound.mediaType }));
	}

	async add(label: string, kind: CustomSoundKind, sound: Blob): Promise<CustomSound> {
		const bytes = new Uint8Array(await sound.arrayBuffer());
		return invoke('sounds.add', { label, kind, mediaType: sound.type, bytes });
	}

	remove(id: string): Promise<void> {
		return invoke('sounds.remove', { id });
	}

	async pickFile(): Promise<Readonly<{ name: string; sound: Blob }> | null> {
		const picked = await invoke('sounds.pick-file', undefined);
		return picked
			? { name: picked.name, sound: new Blob([picked.bytes], { type: picked.mediaType }) }
			: null;
	}

	async playable(sound: Blob): Promise<boolean> {
		if (!sound.type.startsWith('audio/')) return false;
		const context = new AudioContext();
		try {
			await context.decodeAudioData(await sound.arrayBuffer());
			return true;
		} catch {
			return false;
		} finally {
			void context.close();
		}
	}

	askForMicrophone(): Promise<boolean> {
		return invoke('sounds.ask-microphone', undefined);
	}

	openMicrophoneSettings(): Promise<void> {
		return invoke('sounds.open-microphone-settings', undefined);
	}
}

export const soundsService = new SoundsService();
