import type { AboutPanelOptionsOptions, MenuItemConstructorOptions } from 'electron';
import type { MenuCommand } from '$contract/events';

type Choose = (command: MenuCommand) => void;

const SEPARATOR: MenuItemConstructorOptions = { type: 'separator' };

const ZOOM_IN_WITHOUT_SHIFT: MenuItemConstructorOptions = {
	role: 'zoomIn',
	accelerator: 'CommandOrControl+=',
	visible: false,
};

const SOURCE_URL = 'https://github.com/bestboyhq/malini';

const CREDITS = [
	'Malini is free software: you may convey and modify it under the GNU Affero General Public License, version 3 only. It comes with no warranty.',
	`Source code and license: ${SOURCE_URL}`,
	'The Malini and Best Boy names and logos are trademarks of Szymon Grącki, and the license grants no rights to them.',
	'Built on Electron, Chromium and Node.js. Includes the Claude Agent SDK by Anthropic, GitHub CLI, RTK, Material Icon Theme, sounds from the Android Open Source Project and the KDE Ocean sound theme, and the Geist, Geist Mono, Inter and STIX Two Text fonts. Keep working with the lid closed comes from Close My Lid by Krish Kalaria. Their notices are in NOTICE and THIRD_PARTY_NOTICES.txt inside the app.',
].join('\n\n');

export function aboutPanel(appName: string, version: string): AboutPanelOptionsOptions {
	return {
		applicationName: appName,
		applicationVersion: version,
		version,
		copyright: 'Copyright (C) 2026 Szymon Grącki and Malini contributors',
		credits: CREDITS,
	};
}

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
	const updates = update ? [update] : [];
	const settings = command(choose, 'settings', 'Settings…', 'CommandOrControl+,');
	const file: MenuItemConstructorOptions[] = [
		command(choose, 'new-workstream', 'New Workstream', 'CommandOrControl+N'),
		command(choose, 'new-chat', 'New Chat', 'CommandOrControl+T'),
		command(choose, 'reopen-chat', 'Reopen Closed Chat', 'CommandOrControl+Shift+T'),
		SEPARATOR,
		command(choose, 'open-folder', 'Open Folder…', 'CommandOrControl+O'),
		command(choose, 'find-repository', 'Find Repository…'),
		SEPARATOR,
	];
	const closeWindow: MenuItemConstructorOptions = { role: 'close', label: 'Close Window' };
	const standard: MenuItemConstructorOptions[] = [
		{ role: 'editMenu' },
		{ role: 'viewMenu' },
		{ role: 'windowMenu' },
	];
	if (process.platform !== 'darwin') {
		return [
			{
				label: 'File',
				submenu: [
					...file,
					settings,
					SEPARATOR,
					closeWindow,
					{ role: 'quit' },
					ZOOM_IN_WITHOUT_SHIFT,
				],
			},
			...standard,
			{ role: 'help', submenu: [...updates, { role: 'about', label: `About ${appName}` }] },
		];
	}
	return [
		{
			label: appName,
			submenu: [
				{ role: 'about' },
				...updates,
				SEPARATOR,
				settings,
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
		{ label: 'File', submenu: [...file, closeWindow] },
		...standard,
	];
}
