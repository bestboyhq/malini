export const LID_HOLD_SETTING = 'app.lid-hold';

export function holdsLid(setting: string | null | undefined): boolean {
	return setting === 'on';
}
