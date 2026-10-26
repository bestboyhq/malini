import type { AboutPanelOptionsOptions, MenuItemConstructorOptions } from 'electron';
import type { MenuCommand } from '$contract/events';

type Choose = (command: MenuCommand) => void;

const SEPARATOR: MenuItemConstructorOptions = { type: 'separator' };

const SOURCE_URL = 'https://github.com/bestboyhq/malini';

const CREDITS = [
	'Malini is free software: you may convey and modify it under the GNU Affero General Public License, version 3 only. It comes with no warranty.',
	`Source code and license: ${SOURCE_URL}`,
	'The Malini and Best Boy names and logos are trademarks of Szymon Grącki, and the license grants no rights to them.',
	'Built on Electron, Chromium and Node.js. Includes the Claude Agent SDK by Anthropic, GitHub CLI, Material Icon Theme, sounds from the Android Open Source Project and the KDE Ocean sound theme, and the Geist, Geist Mono, Inter and STIX Two Text fonts. Their notices are in NOTICE and THIRD_PARTY_NOTICES.txt inside the app.',
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
