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
	menu: string;
	dock: string;
	systemSettings: string;
	trash: string;
	terminal: string;
	environment: string;
	claudeInstallCommand: string;
	quit: string;
	appMenu: string;
	primaryKey: string;
	primaryReturn: string;
	returnKey: string;
	backspaceKey: string;
	interrupt: string;
	shortcut: (key: string) => string;
	ariaShortcut: (key: string) => string;
	primaryHeld: (event: ModifierKeys) => boolean;
}>;

const SH_INSTALL = 'curl -fsSL https://claude.ai/install.sh | bash';

const CTRL_KEYBOARD = {
	primaryKey: 'Ctrl',
	primaryReturn: 'Ctrl+Enter',
	returnKey: 'Enter',
	backspaceKey: 'Backspace',
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
		menu: 'menu bar',
		dock: 'Dock',
		systemSettings: 'System Settings',
		trash: 'Trash',
		terminal: 'Terminal',
		environment: 'your shell',
		claudeInstallCommand: SH_INSTALL,
		quit: 'Quit',
		appMenu: 'the menu bar',
		primaryKey: '⌘',
		primaryReturn: 'Command Return',
		returnKey: 'Return',
		backspaceKey: '⌫',
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
		menu: 'menu',
		dock: 'taskbar',
		systemSettings: 'Settings',
		trash: 'Recycle Bin',
		terminal: 'PowerShell',
		environment: 'your environment variables',
		claudeInstallCommand: 'irm https://claude.ai/install.ps1 | iex',
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
		menu: 'menu',
		dock: 'taskbar',
		systemSettings: 'system settings',
		trash: 'Trash',
		terminal: 'a terminal',
		environment: 'your shell',
		claudeInstallCommand: SH_INSTALL,
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

const TEXT_WORDS = ['machine', 'tray', 'menu'] as const;

export function osText(text: string, os: Os): string {
	return TEXT_WORDS.reduce((filled, word) => filled.replaceAll(`{${word}}`, os[word]), text);
}
