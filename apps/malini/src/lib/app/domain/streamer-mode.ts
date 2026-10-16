export type StreamerMode = 'auto' | 'on' | 'off';

export const STREAMER_MODES: readonly StreamerMode[] = ['auto', 'on', 'off'];

export function parseStreamerMode(raw: string | null): StreamerMode {
	return STREAMER_MODES.find((mode) => mode === raw) ?? 'auto';
}

export function masksPersonalData(mode: StreamerMode, streaming: boolean): boolean {
	return mode === 'on' || (mode === 'auto' && streaming);
}
