import { Menu, type BrowserWindow } from 'electron';
import type { PopUpMenuArgs, WindowControlsTint } from '$contract/commands';
import type { CommandRegistry } from '$main/ipc/registry';
import { windowControlsOverlay } from '$main/window';

const HEX_COLOR = /^#[0-9a-f]{6}$/iu;

export function defineWindowControlsCommands(
	commands: CommandRegistry,
	getMainWindow: () => BrowserWindow | null,
	platform: NodeJS.Platform,
): void {
	commands.define('app.tint-window-controls', (args: WindowControlsTint) => {
		const tint = {
			background: hexColor(args?.background, 'background'),
			symbol: hexColor(args?.symbol, 'symbol'),
		};
		if (platform === 'darwin') return;
		getMainWindow()?.setTitleBarOverlay(windowControlsOverlay(tint));
	});
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

function hexColor(value: unknown, name: string): string {
	if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
		throw new Error(`${name} must be a #rrggbb color`);
	}
	return value;
}

function coordinate(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new Error(`${name} must be a number of pixels from the window's top left`);
	}
	return value;
}
