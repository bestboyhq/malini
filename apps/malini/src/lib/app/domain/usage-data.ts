export const USAGE_DATA_SETTING = 'usage-data';

export function usageDataShared(setting: string | null | undefined): boolean {
	return setting !== 'off';
}

export function usageDataSetting(shared: boolean): string {
	return shared ? 'on' : 'off';
}
