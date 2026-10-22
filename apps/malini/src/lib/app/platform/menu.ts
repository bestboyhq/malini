import type { MenuItemConstructorOptions } from 'electron';
import type { MenuCommand } from '$contract/events';

type Choose = (command: MenuCommand) => void;

const SEPARATOR: MenuItemConstructorOptions = { type: 'separator' };

function command(
	choose: Choose,
	id: MenuCommand,
	label: string,
	accelerator?: string,
): MenuItemConstructorOptions {
	return { id, label, ...(accelerator ? { accelerator } : {}), click: () => choose(id) };
}

export function applicationMenu(
	appName: string,
	update: MenuItemConstructorOptions | null,
	choose: Choose,
): MenuItemConstructorOptions[] {
	return [
		{
			label: appName,
			submenu: [
				{ role: 'about' },
				...(update ? [update] : []),
				SEPARATOR,
				command(choose, 'settings', 'Settings…', 'CommandOrControl+,'),
				SEPARATOR,
				{ role: 'services' },
				SEPARATOR,
				{ role: 'hide' },
				{ role: 'hideOthers' },
				{ role: 'unhide' },
				SEPARATOR,
				{ role: 'quit' },
			],
		},
		{
			label: 'File',
			submenu: [
				command(choose, 'new-workstream', 'New Workstream', 'CommandOrControl+N'),
				command(choose, 'new-chat', 'New Chat', 'CommandOrControl+T'),
				SEPARATOR,
				command(choose, 'open-folder', 'Open Folder…', 'CommandOrControl+O'),
				command(choose, 'clone-repository', 'Clone Repository…'),
				SEPARATOR,
				{ role: 'close' },
			],
		},
		{ role: 'editMenu' },
		{ role: 'viewMenu' },
		{ role: 'windowMenu' },
	];
}
