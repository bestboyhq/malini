import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';

export interface FilePicker {
	pickFiles(): Promise<string[]>;
}

export function createElectronFilePicker(): FilePicker {
	return {
		async pickFiles() {
			const options: OpenDialogOptions = { properties: ['openFile', 'multiSelections'] };
			const owner = BrowserWindow.getFocusedWindow();
			const result = owner
				? await dialog.showOpenDialog(owner, options)
				: await dialog.showOpenDialog(options);
			return result.canceled ? [] : result.filePaths;
		},
	};
}
