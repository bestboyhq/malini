export const VIDEO_SPEEDS = [1, 0.5, 0.25] as const;

export type VideoSpeed = (typeof VIDEO_SPEEDS)[number];

export type VideoPreferences = Readonly<{ muted: boolean; volume: number; speed: VideoSpeed }>;

export const DEFAULT_VIDEO_PREFERENCES: VideoPreferences = { muted: true, volume: 1, speed: 1 };

export function parseVideoPreferences(raw: string | null): VideoPreferences {
	let saved: unknown;
	try {
		saved = JSON.parse(raw ?? 'null');
	} catch {
		return DEFAULT_VIDEO_PREFERENCES;
	}
	if (typeof saved !== 'object' || saved === null) return DEFAULT_VIDEO_PREFERENCES;
	const muted: unknown = Reflect.get(saved, 'muted');
	const volume: unknown = Reflect.get(saved, 'volume');
	const speed: unknown = Reflect.get(saved, 'speed');
	return {
		muted: typeof muted === 'boolean' ? muted : DEFAULT_VIDEO_PREFERENCES.muted,
		volume:
			typeof volume === 'number' && volume >= 0 && volume <= 1
				? volume
				: DEFAULT_VIDEO_PREFERENCES.volume,
		speed: VIDEO_SPEEDS.find((each) => each === speed) ?? DEFAULT_VIDEO_PREFERENCES.speed,
	};
}

export function nextVideoSpeed(speed: VideoSpeed): VideoSpeed {
	return VIDEO_SPEEDS[(VIDEO_SPEEDS.indexOf(speed) + 1) % VIDEO_SPEEDS.length] ?? 1;
}
