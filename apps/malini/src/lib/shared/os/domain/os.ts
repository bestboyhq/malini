export type OsPlatform = 'darwin' | 'win32' | 'linux';

export type ModifierKeys = Readonly<{ metaKey: boolean; ctrlKey: boolean }>;

export type Os = Readonly<{
	platform: OsPlatform;
	name: string;
	machine: string;
	fileManager: string;
	reveal: string;
	keychain: string;
	machineKeychain: string;
	secretStore: string;
	unlockSecretStore: string;
	tray: string;
	dock: string;
	systemSettings: string;
	trash: string;
	terminal: string;
	quit: string;
	appMenu: string;
	primaryKey: string;
	primaryReturn: string;
	returnKey: string;
	interrupt: string;
	shortcut: (key: string) => string;
	ariaShortcut: (key: string) => string;
	primaryHeld: (event: ModifierKeys) => boolean;
}>;

const CTRL_KEYBOARD = {
	primaryKey: 'Ctrl',
	primaryReturn: 'Ctrl+Enter',
	returnKey: 'Enter',
	interrupt: 'Ctrl+C',
	shortcut: (key: string): string => `Ctrl+${key}`,
	ariaShortcut: (key: string): string => `Control+${key}`,
	primaryHeld: (event: ModifierKeys): boolean => event.ctrlKey && !event.metaKey,
};

const OS: Readonly<Record<OsPlatform, Os>> = {
	darwin: {
		platform: 'darwin',
		name: 'macOS',
		machine: 'Mac',
		fileManager: 'Finder',
		reveal: 'Reveal in Finder',
		keychain: 'keychain',
		machineKeychain: "Mac's keychain",
		secretStore: 'the macOS keychain',
		unlockSecretStore: 'Unlock it',
		tray: 'menu bar',
		dock: 'Dock',
		systemSettings: 'System Settings',
		trash: 'Trash',
		terminal: 'Terminal',
		quit: 'Quit',
		appMenu: 'the menu bar',
		primaryKey: '⌘',
		primaryReturn: 'Command Return',
		returnKey: 'Return',
		interrupt: 'Control-C',
		shortcut: (key) => `⌘${key}`,
		ariaShortcut: (key) => `Meta+${key}`,
		primaryHeld: (event) => event.metaKey && !event.ctrlKey,
	},
	win32: {
		platform: 'win32',
		name: 'Windows',
		machine: 'PC',
		fileManager: 'File Explorer',
		reveal: 'Show in File Explorer',
		keychain: 'Windows account',
		machineKeychain: 'Windows account',
		secretStore: 'your Windows account',
		unlockSecretStore: 'Restart Malini',
		tray: 'taskbar corner',
		dock: 'taskbar',
		systemSettings: 'Settings',
		trash: 'Recycle Bin',
		terminal: 'Windows Terminal',
		quit: 'Exit',
		appMenu: 'the menu',
		...CTRL_KEYBOARD,
	},
	linux: {
		platform: 'linux',
		name: 'Linux',
		machine: 'computer',
		fileManager: 'file manager',
		reveal: 'Open containing folder',
		keychain: 'keyring',
		machineKeychain: 'keyring',
		secretStore: 'your keyring',
		unlockSecretStore: 'Start or unlock it',
		tray: 'tray',
		dock: 'taskbar',
		systemSettings: 'system settings',
		trash: 'Trash',
		terminal: 'a terminal',
		quit: 'Quit',
		appMenu: 'the menu',
		...CTRL_KEYBOARD,
	},
};

export function osPlatform(value: string): OsPlatform {
	return value === 'darwin' || value === 'win32' ? value : 'linux';
}

export function osFor(platform: string): Os {
	return OS[osPlatform(platform)];
}
