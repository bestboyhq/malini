import { beforeEach, describe, expect, it, vi } from 'vitest';

const popup = vi.fn();

vi.mock('electron', () => ({
	BrowserWindow: {},
	Menu: { getApplicationMenu: () => ({ popup }) },
}));

import { CommandRegistry } from '$main/ipc/registry';
import { asBrowserWindow } from './test-support';
import { defineWindowControlsCommands } from './window-controls';

function setUp(): { commands: CommandRegistry; window: unknown } {
	const commands = new CommandRegistry();
	const window = asBrowserWindow({ webContents: { getZoomFactor: () => 1.25 } });
	defineWindowControlsCommands(commands, () => window);
	return { commands, window };
}

beforeEach(() => {
	popup.mockClear();
});

describe('the application menu button', () => {
	it('pops up the application menu where the page asks, in window pixels at its zoom', async () => {
		const { commands, window } = setUp();
		await commands.call('app.pop-up-menu', { x: 12, y: 40 });
		expect(popup).toHaveBeenCalledWith({ window, x: 15, y: 50 });
	});

	it('refuses a menu position outside the page', async () => {
		const { commands } = setUp();
		const replies = await Promise.all(
			[{ x: -1, y: 40 }, { x: 12, y: Number.NaN }, { x: '12', y: 40 }, null].map((args) =>
				commands.invoke({ command: 'app.pop-up-menu', args }),
			),
		);
		expect(replies.map((reply) => reply.ok)).toEqual([false, false, false, false]);
		expect(popup).not.toHaveBeenCalled();
	});
});
