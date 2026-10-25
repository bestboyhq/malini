import { dialog, type BrowserWindow, type OpenDialogOptions } from 'electron';
import { SOUND_FILE_EXTENSIONS } from './sound-file';

export async function pickSoundFile(window: BrowserWindow | null): Promise<string | null> {
	const options: OpenDialogOptions = {
		properties: ['openFile'],
		filters: [{ name: 'Sounds', extensions: [...SOUND_FILE_EXTENSIONS] }],
	};
	const result = window
		? await dialog.showOpenDialog(window, options)
		: await dialog.showOpenDialog(options);
	return result.canceled ? null : (result.filePaths[0] ?? null);
}
