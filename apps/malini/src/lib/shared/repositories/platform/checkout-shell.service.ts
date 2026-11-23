import { shell } from 'electron';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { trySpawnDetached } from '$main/process/detached';
import { WorkstreamError } from './checkout-resolver';

function openFailed(error: string | undefined): WorkstreamError {
	return new WorkstreamError('open-failed', `open failed: ${error ?? 'unknown error'}`);
}

export interface CheckoutShell {
	reveal(path: string): Promise<void>;
	openInEditor(path: string): Promise<void>;
}

async function openFolder(path: string): Promise<void> {
	const error = await shell.openPath(path);
	if (error) throw openFailed(error);
}

function editorSearchPath(): Readonly<Record<string, string>> {
	if (process.platform === 'win32') return {};
	const folders = [
		join(homedir(), '.local', 'bin'),
		'/opt/homebrew/bin',
		'/usr/local/bin',
		'/usr/bin',
		'/bin',
		process.env['PATH'] ?? '',
	];
	return { PATH: folders.join(delimiter) };
}

export const defaultCheckoutShell: CheckoutShell = {
	reveal: openFolder,
	async openInEditor(path) {
		if ((await trySpawnDetached('code', [path], editorSearchPath())).launched) return;
		await openFolder(path);
	},
};
