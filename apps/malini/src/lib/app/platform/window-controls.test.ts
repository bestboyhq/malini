import { beforeEach, describe, expect, it, vi } from 'vitest';

const popup = vi.fn();

vi.mock('electron', () => ({
	BrowserWindow: {},
	Menu: { getApplicationMenu: () => ({ popup }) },
	nativeImage: {},
	nativeTheme: {},
	screen: {},
	shell: {},
}));

import { CommandRegistry } from '$main/ipc/registry';
import { asBrowserWindow } from './test-support';
import { defineWindowControlsCommands } from './window-controls';

function setUp(platform: NodeJS.Platform): {
	commands: CommandRegistry;
	overlays: unknown[];
	window: unknown;
} {
	const commands = new CommandRegistry();
	const overlays: unknown[] = [];
	const window = asBrowserWindow({
		setTitleBarOverlay: (options: unknown) => overlays.push(options),
		webContents: { getZoomFactor: () => 1.25 },
	});
	defineWindowControlsCommands(commands, () => window, platform);
	return { commands, overlays, window };
}

beforeEach(() => {
	popup.mockClear();
});

describe('window controls', () => {
	it.each(['win32', 'linux'] as const)(
		'tints the %s caption buttons in the top bar colors and lets the page show through',
		async (platform) => {
			const { commands, overlays } = setUp(platform);
			await commands.call('app.tint-window-controls', { background: '#161413', symbol: '#b8b5b2' });
			expect(overlays).toEqual([{ color: 'rgba(22, 20, 19, 0)', symbolColor: '#b8b5b2' }]);
		},
	);

	it('leaves the macOS traffic lights alone', async () => {
		const { commands, overlays } = setUp('darwin');
		await commands.call('app.tint-window-controls', { background: '#ede9e7', symbol: '#42403f' });
		expect(overlays).toEqual([]);
	});

	it('refuses a tint that is not a #rrggbb color', async () => {
		const { commands, overlays } = setUp('linux');
		const reply = await commands.invoke({
			command: 'app.tint-window-controls',
			args: { background: 'oklch(0.2 0 0)', symbol: '#b8b5b2' },
		});
		expect(reply.ok).toBe(false);
		expect(overlays).toEqual([]);
	});

	it('pops up the application menu where the page asks, in window pixels at its zoom', async () => {
		const { commands, window } = setUp('win32');
		await commands.call('app.pop-up-menu', { x: 12, y: 40 });
		expect(popup).toHaveBeenCalledWith({ window, x: 15, y: 50 });
	});

	it('refuses a menu position outside the page', async () => {
		const { commands } = setUp('linux');
		const replies = await Promise.all(
			[{ x: -1, y: 40 }, { x: 12, y: Number.NaN }, { x: '12', y: 40 }, null].map((args) =>
				commands.invoke({ command: 'app.pop-up-menu', args }),
			),
		);
		expect(replies.map((reply) => reply.ok)).toEqual([false, false, false, false]);
		expect(popup).not.toHaveBeenCalled();
	});
});
