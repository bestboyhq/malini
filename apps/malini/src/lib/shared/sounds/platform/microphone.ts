import { shell, systemPreferences } from 'electron';

const MICROPHONE_SETTINGS: Partial<Record<NodeJS.Platform, string>> = {
	darwin: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
	win32: 'ms-settings:privacy-microphone',
};

export async function askForMicrophone(): Promise<boolean> {
	if (process.platform !== 'darwin' && process.platform !== 'win32') return true;
	const status = systemPreferences.getMediaAccessStatus('microphone');
	if (status === 'not-determined' && process.platform === 'darwin') {
		return systemPreferences.askForMediaAccess('microphone');
	}
	return status !== 'denied' && status !== 'restricted';
}

export async function openMicrophoneSettings(): Promise<void> {
	const url = MICROPHONE_SETTINGS[process.platform];
	if (url) await shell.openExternal(url);
}
