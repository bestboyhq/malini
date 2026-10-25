import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { SOUND_MAX_BYTES, type PickedSound } from '$contract/sounds';

const MEDIA_TYPES: Readonly<Record<string, string>> = {
	aac: 'audio/aac',
	flac: 'audio/flac',
	m4a: 'audio/mp4',
	mp3: 'audio/mpeg',
	oga: 'audio/ogg',
	ogg: 'audio/ogg',
	opus: 'audio/ogg',
	wav: 'audio/wav',
	weba: 'audio/webm',
	webm: 'audio/webm',
};

export const SOUND_FILE_EXTENSIONS: readonly string[] = Object.keys(MEDIA_TYPES);

export async function readSoundFile(path: string): Promise<PickedSound> {
	const name = basename(path);
	const mediaType = MEDIA_TYPES[extname(name).slice(1).toLowerCase()];
	if (!mediaType) throw new Error(`${name} is not a sound file Malini can play`);
	if ((await stat(path)).size > SOUND_MAX_BYTES) {
		throw new Error(`a sound can be at most ${SOUND_MAX_BYTES / 1024 / 1024} MB`);
	}
	return { name, mediaType, bytes: new Uint8Array(await readFile(path)) };
}
