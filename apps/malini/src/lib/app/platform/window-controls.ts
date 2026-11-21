import { Menu, type BrowserWindow } from 'electron';
import type { PopUpMenuArgs } from '$contract/commands';
import type { CommandRegistry } from '$main/ipc/registry';
import { AppError } from './app-error';

export function defineWindowControlsCommands(
	commands: CommandRegistry,
	getMainWindow: () => BrowserWindow | null,
): void {
	commands.define('app.pop-up-menu', (args: PopUpMenuArgs) => {
		const at = { x: coordinate(args?.x, 'x'), y: coordinate(args?.y, 'y') };
		const window = getMainWindow();
		if (!window) return;
		const zoom = window.webContents.getZoomFactor();
		Menu.getApplicationMenu()?.popup({
			window,
			x: Math.round(at.x * zoom),
			y: Math.round(at.y * zoom),
		});
	});
}

function coordinate(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new AppError(
			'invalid-argument',
			`${name} must be a number of pixels from the window's top left`,
		);
	}
	return value;
}
