export type CustomSoundKind = 'recording' | 'file';

export type CustomSound = Readonly<{
	id: string;
	label: string;
	kind: CustomSoundKind;
	createdAt: string;
}>;

export type SoundIdArgs = Readonly<{ id: string }>;

export type SoundBytes = Readonly<{ mediaType: string; bytes: Uint8Array<ArrayBuffer> }>;

export type AddSoundArgs = Readonly<{
	label: string;
	kind: CustomSoundKind;
	mediaType: string;
	bytes: Uint8Array<ArrayBuffer>;
}>;

export type PickedSound = Readonly<{
	name: string;
	mediaType: string;
	bytes: Uint8Array<ArrayBuffer>;
}>;

export const CUSTOM_SOUND_KINDS: readonly CustomSoundKind[] = ['recording', 'file'];

export const SOUND_MAX_BYTES = 5 * 1024 * 1024;

export const SOUND_LABEL_MAX_LENGTH = 80;
