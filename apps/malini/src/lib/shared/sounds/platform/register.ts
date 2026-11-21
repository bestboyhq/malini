import { SOUND_LABEL_MAX_LENGTH, SOUND_MAX_BYTES } from '$contract/sounds';
import type { MainContext } from '$main/context';
import { isRecord } from '$main/db/rows';
import { isCustomSoundKind } from '../domain/sounds';
import {
	addCustomSound,
	listCustomSounds,
	readCustomSound,
	removeCustomSound,
	type NewCustomSound,
} from './sounds.repository';
import { readSoundFile, SoundError, soundTooLarge } from './sound-file';

const AUDIO_MEDIA_TYPE = /^audio\/[\w.+-]+(?:;[\w .=+-]*)?$/u;

export type SoundsPlatformDependencies = Readonly<{
	askForMicrophone(): Promise<boolean>;
	openMicrophoneSettings(): Promise<void>;
	pickSoundFile(): Promise<string | null>;
}>;

export function registerSounds(
	context: MainContext,
	dependencies: SoundsPlatformDependencies,
): void {
	const { db, commands } = context;

	commands.define('sounds.list', () => listCustomSounds(db));

	commands.define('sounds.read', (args: unknown) => {
		const id = soundId(args);
		const sound = readCustomSound(db, id);
		if (!sound) throw new SoundError('not-found', `no sound \`${id}\``);
		return sound;
	});

	commands.define('sounds.add', (args: unknown) => addCustomSound(db, newSound(args)));

	commands.define('sounds.remove', (args: unknown) => removeCustomSound(db, soundId(args)));

	commands.define('sounds.pick-file', async () => {
		const path = await dependencies.pickSoundFile();
		return path ? readSoundFile(path) : null;
	});

	commands.define('sounds.ask-microphone', () => dependencies.askForMicrophone());

	commands.define('sounds.open-microphone-settings', () => dependencies.openMicrophoneSettings());
}

function soundId(args: unknown): string {
	const value = isRecord(args) ? args['id'] : undefined;
	if (typeof value !== 'string' || value.length === 0) {
		throw new SoundError('invalid-argument', 'invalid args: `id` must be a sound id');
	}
	return value;
}

function newSound(args: unknown): NewCustomSound {
	if (!isRecord(args))
		throw new SoundError('invalid-argument', 'invalid args: a sound must be an object');
	const { label, kind, mediaType, bytes } = args;
	if (typeof label !== 'string' || label.trim().length === 0) {
		throw new SoundError('invalid-argument', 'invalid args: `label` must name the sound');
	}
	if (!isCustomSoundKind(kind))
		throw new SoundError('invalid-argument', 'invalid args: `kind` must be recording or file');
	if (typeof mediaType !== 'string' || !AUDIO_MEDIA_TYPE.test(mediaType)) {
		throw new SoundError('invalid-argument', 'invalid args: `mediaType` must be an audio type');
	}
	if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
		throw new SoundError('invalid-argument', 'invalid args: `bytes` must hold the sound');
	}
	if (bytes.length > SOUND_MAX_BYTES) throw soundTooLarge();
	return { label: label.trim().slice(0, SOUND_LABEL_MAX_LENGTH), kind, mediaType, bytes };
}
