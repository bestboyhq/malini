import { CUSTOM_SOUND_KINDS, type CustomSound, type CustomSoundKind } from '$contract/sounds';

export type SoundSignal = 'finished' | 'needs-you';

export type SoundOption = Readonly<{ id: string; label: string; custom: boolean }>;

export type SoundChoices = Readonly<Record<SoundSignal, string>>;

export const SOUND_SIGNALS: readonly SoundSignal[] = ['finished', 'needs-you'];

export const NO_SOUND = 'none';

export const MAX_RECORDING_MS = 3000;

export const RECORDING_LEVEL_BARS = 24;

export type SoundRecorderPhase = 'asking' | 'ready' | 'denied' | 'recording';

export type SoundRecorderState = Readonly<{
	signal: SoundSignal;
	phase: SoundRecorderPhase;
	elapsedMs: number;
	levels: readonly number[];
}>;

export type LoadedSounds = Readonly<{ choices: SoundChoices; custom: readonly CustomSound[] }>;

export const BUILT_IN_SOUNDS: readonly SoundOption[] = [
	{ id: 'chime', label: 'Malini chime', custom: false },
	{ id: 'acrux', label: 'Acrux', custom: false },
	{ id: 'adara', label: 'Adara', custom: false },
	{ id: 'ariel', label: 'Ariel', custom: false },
	{ id: 'carme', label: 'Carme', custom: false },
	{ id: 'ceres', label: 'Ceres', custom: false },
	{ id: 'device-added', label: 'Device added', custom: false },
	{ id: 'iapetus', label: 'Iapetus', custom: false },
	{ id: 'nfc-success', label: 'NFC success', custom: false },
	{ id: 'palladium', label: 'Palladium', custom: false },
	{ id: 'rhea', label: 'Rhea', custom: false },
	{ id: 'rubidium', label: 'Rubidium', custom: false },
	{ id: 'service-login', label: 'Service login', custom: false },
	{ id: 'shaula', label: 'Shaula', custom: false },
	{ id: 'tethys', label: 'Tethys', custom: false },
	{ id: 'titan', label: 'Titan', custom: false },
	{ id: 'wireless-charging', label: 'Wireless charging', custom: false },
];

export const DEFAULT_SOUND_CHOICES: SoundChoices = { finished: 'chime', 'needs-you': 'tethys' };

export function soundSettingKey(signal: SoundSignal): string {
	return `sounds.${signal}`;
}

export function soundChoices(settings: Readonly<Record<string, string>>): SoundChoices {
	return {
		finished: settings[soundSettingKey('finished')] ?? DEFAULT_SOUND_CHOICES.finished,
		'needs-you': settings[soundSettingKey('needs-you')] ?? DEFAULT_SOUND_CHOICES['needs-you'],
	};
}

export function builtInSoundPath(id: string): string | null {
	return BUILT_IN_SOUNDS.some((sound) => sound.id === id) ? `sounds/${id}.flac` : null;
}

export function customSoundOptions(sounds: readonly CustomSound[]): SoundOption[] {
	return sounds.map((sound) => ({ id: sound.id, label: sound.label, custom: true }));
}

export function playableSound(
	choice: string,
	signal: SoundSignal,
	custom: readonly CustomSound[],
): string | null {
	if (choice === NO_SOUND) return null;
	if (builtInSoundPath(choice) || custom.some((sound) => sound.id === choice)) return choice;
	return DEFAULT_SOUND_CHOICES[signal];
}

export function isCustomSoundKind(value: unknown): value is CustomSoundKind {
	return CUSTOM_SOUND_KINDS.some((kind) => kind === value);
}

export function nextRecordingLabel(sounds: readonly CustomSound[]): string {
	return `Recording ${sounds.filter((sound) => sound.kind === 'recording').length + 1}`;
}

export function fileSoundLabel(fileName: string): string {
	return fileName.replace(/\.[^.]+$/u, '').trim() || 'Your sound';
}
