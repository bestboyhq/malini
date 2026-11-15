import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import { bubblewrap } from './sandbox/bubblewrap.js';
import { windows } from './sandbox/windows.js';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
export const SECRETS_FOLDER_PREFIX = 'malini-secrets-';
export const OUTSIDE_THE_SANDBOX = 'malini-outside-';
export const INSIDE_THE_SANDBOX = 'malini-inside-';
export const SANDBOX_TAG_PREFIX = 'malini-sandbox-';
export const SANDBOX_ENVIRONMENT = { ELECTRON_DISABLE_SANDBOX: '1' } as const;
export const APP_DATA_ROOT = 'MALINI_APP_DATA_ROOT';

const CLAUDE_CHAT_RECORDS = [
	'projects',
	'history.jsonl',
	'paste-cache',
	'plans',
	'sessions',
	'todos',
	'file-history',
	'transcripts',
];

const CREDENTIALS = [
	'.ssh',
	'.secrets',
	'.aws',
	'.azure',
	'.gnupg',
	'.kube',
	'.docker',
	'.netrc',
	'.config/gcloud',
	'Library/Cookies',
	'Library/Application Support/Google/Chrome',
	'Library/Application Support/Firefox',
	'Library/Application Support/Arc',
	'Library/Application Support/BraveSoftware',
	'Library/Application Support/Microsoft Edge',
];

export const USER_DATA = [
	'Documents',
	'Desktop',
	'Downloads',
	'Pictures',
	'Movies',
	'Music',
	'Library/Mail',
	'Library/Messages',
	'Library/Mobile Documents',
	'Library/Photos',
	'Library/Safari',
	'Library/Calendars',
	'Library/Reminders',
	'Library/Application Support/AddressBook',
	'Library/Containers',
	'Library/Group Containers',
];

const RUN_OUTSIDE_LATER = [
	'Library/LaunchAgents',
	'.zshrc',
	'.zshenv',
	'.zprofile',
	'.zlogin',
	'.zlogout',
	'.bashrc',
	'.bash_profile',
	'.bash_login',
	'.profile',
	'.config/fish',
	'.gitconfig',
	'.config/git',
	'.config/gh',
	'.claude',
	'.claude.json',
];
const LINUX_CREDENTIALS = [
	'.ssh',
	'.secrets',
	'.aws',
	'.azure',
	'.gnupg',
	'.kube',
	'.docker',
	'.netrc',
	'.pki',
	'.config/gcloud',
	'.config/sops',
	'.local/share/keyrings',
	'.mozilla',
	'.config/google-chrome',
	'.config/chromium',
	'.config/BraveSoftware',
	'.config/microsoft-edge',
];

const LINUX_USER_DATA = [
	'Documents',
	'Desktop',
	'Downloads',
	'Pictures',
	'Videos',
	'Music',
	'.thunderbird',
	'.local/share/evolution',
];

const LINUX_RUN_OUTSIDE_LATER = [
	'.zshrc',
	'.zshenv',
	'.zprofile',
	'.zlogin',
	'.zlogout',
	'.bashrc',
	'.bash_profile',
	'.bash_login',
	'.bash_logout',
	'.profile',
	'.config/fish',
	'.gitconfig',
	'.config/git',
	'.config/gh',
	'.claude',
	'.claude.json',
	'.config/autostart',
	'.config/systemd/user',
	'.local/share/applications',
];

const LINUX_SHARED_FOLDERS = [
	'/',
	'/etc',
	'/home',
	'/media',
	'/mnt',
	'/opt',
	'/run',
	'/srv',
	'/tmp',
	'/usr',
	'/usr/local',
	'/var',
	'/var/lib',
	'/var/tmp',
];

const LINUX_SHARED_HOME_FOLDERS = [
	'',
	'.cache',
	'.config',
	'.local',
	'.local/share',
	'.local/state',
];
const LINUX_CACHES = ['.cache', '.npm', '.local/share/pnpm'];
const LINUX_TEMP_FOLDERS = ['/tmp', '/var/tmp'];

const WINDOWS_CREDENTIALS = [
	'.ssh',
	'.secrets',
	'.aws',
	'.azure',
	'.gnupg',
	'.kube',
	'.docker',
	'.netrc',
	'_netrc',
	'AppData/Roaming/gcloud',
	'AppData/Roaming/Microsoft/Crypto',
	'AppData/Roaming/Microsoft/Protect',
	'AppData/Roaming/Microsoft/Windows/Credentials',
	'AppData/Local/Microsoft/Credentials',
	'AppData/Local/Microsoft/Vault',
	'AppData/Local/Google/Chrome/User Data',
	'AppData/Local/Microsoft/Edge/User Data',
	'AppData/Local/BraveSoftware',
	'AppData/Roaming/Mozilla/Firefox',
];

const WINDOWS_USER_DATA = [
	'Documents',
	'Desktop',
	'Downloads',
	'Pictures',
	'Videos',
	'Music',
	'OneDrive',
	'Contacts',
	'Favorites',
	'Links',
	'Saved Games',
	'Searches',
	'AppData/Local/Packages',
	'AppData/Local/Microsoft/Outlook',
	'AppData/Roaming/Microsoft/Windows/Recent',
];

const WINDOWS_RUN_OUTSIDE_LATER = [
	'.bashrc',
	'.bash_profile',
	'.bash_login',
	'.bash_logout',
	'.profile',
	'.config/fish',
	'.gitconfig',
	'.config/git',
	'.config/gh',
	'.claude',
	'.claude.json',
	'AppData/Roaming/GitHub CLI',
	'AppData/Roaming/npm',
	'AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup',
];

const WINDOWS_SHARED_FOLDERS = [
	'C:\\Users',
	'C:\\Windows',
	'C:\\Program Files',
	'C:\\Program Files (x86)',
	'C:\\ProgramData',
];

const WINDOWS_SHARED_HOME_FOLDERS = [
	'',
	'AppData',
	'AppData/Local',
	'AppData/Roaming',
	'AppData/LocalLow',
	'.config',
];

const WINDOWS_CACHES = [
	'.cache',
	'.npm',
	'AppData/Local/Temp',
	'AppData/Local/npm-cache',
	'AppData/Local/pnpm/store',
	'AppData/Local/Yarn/Cache',
];

const WINDOWS_TEMP_FOLDERS = ['C:\\Windows\\Temp'];

const KEY_AGENTS = ['.ssh', '.gnupg', '.secrets'];
const SHARED_FOLDERS = [
	'/',
	'/Applications',
	'/Library',
	'/System',
	'/Users',
	'/Volumes',
	'/opt',
	'/opt/homebrew',
	'/private',
	'/private/etc',
	'/private/var',
	'/usr',
	'/usr/local',
];
const SHARED_HOME_FOLDERS = ['', 'Library', '.config', '.local', '.local/share', '.local/state'];

const CACHES = ['Library/Caches', '.cache', '.npm', 'Library/pnpm/store'];
const PNPM_LINK_PROBES = 'Library/pnpm/_tmp_';
const TEMP_FOLDERS = ['/private/tmp', '/private/var/folders'];

interface Policy {
	readonly separator: '/' | '\\';
	readonly credentials: readonly string[];
	readonly userData: readonly string[];
	readonly runOutsideLater: readonly string[];
	readonly sharedFolders: readonly string[];
	readonly sharedHomeFolders: readonly string[];
	readonly sharedHomeParents: readonly string[];
	readonly caches: readonly string[];
	readonly temp: readonly string[];
	readonly toolStateNamed: readonly string[];
	readonly toolStateAny: readonly string[];
}

const POLICIES = {
	darwin: {
		separator: '/',
		credentials: CREDENTIALS,
		userData: USER_DATA,
		runOutsideLater: RUN_OUTSIDE_LATER,
		sharedFolders: SHARED_FOLDERS,
		sharedHomeFolders: SHARED_HOME_FOLDERS,
		sharedHomeParents: ['Library'],
		caches: CACHES,
		temp: TEMP_FOLDERS,
		toolStateNamed: ['Library/Application Support/'],
		toolStateAny: ['Library/Logs/', '.local/state/'],
	},
	linux: {
		separator: '/',
		credentials: LINUX_CREDENTIALS,
		userData: LINUX_USER_DATA,
		runOutsideLater: LINUX_RUN_OUTSIDE_LATER,
		sharedFolders: LINUX_SHARED_FOLDERS,
		sharedHomeFolders: LINUX_SHARED_HOME_FOLDERS,
		sharedHomeParents: [],
		caches: LINUX_CACHES,
		temp: LINUX_TEMP_FOLDERS,
		toolStateNamed: [],
		toolStateAny: ['.local/state/'],
	},
	win32: {
		separator: '\\',
		credentials: WINDOWS_CREDENTIALS,
		userData: WINDOWS_USER_DATA,
		runOutsideLater: WINDOWS_RUN_OUTSIDE_LATER,
		sharedFolders: WINDOWS_SHARED_FOLDERS,
		sharedHomeFolders: WINDOWS_SHARED_HOME_FOLDERS,
		sharedHomeParents: ['AppData'],
		caches: WINDOWS_CACHES,
		temp: WINDOWS_TEMP_FOLDERS,
		toolStateNamed: ['AppData/Roaming/', 'AppData/Local/'],
		toolStateAny: ['.local/state/'],
	},
} as const satisfies Record<string, Policy>;

function policyFor(platform: NodeJS.Platform): Policy {
	if (platform === 'linux') return POLICIES.linux;
	return platform === 'win32' ? POLICIES.win32 : POLICIES.darwin;
}
const DEVICES = [
	'(literal "/dev/null")',
	'(literal "/dev/zero")',
	'(literal "/dev/tty")',
	'(literal "/dev/ptmx")',
	'(literal "/dev/dtracehelper")',
	'(regex #"^/dev/ttys[0-9]+$")',
];

const SERVICES = [
	'com.apple.analyticsd',
	'com.apple.appkit.restoration_storage',
	'com.apple.backupd.sandbox.xpc',
	'com.apple.cache_delete.public',
	'com.apple.CARenderServer',
	'com.apple.cfprefsd.agent',
	'com.apple.cfprefsd.daemon',
	'com.apple.coreservices.launchservicesd',
	'com.apple.diagnosticd',
	'com.apple.DiskArbitration.diskarbitrationd',
	'com.apple.distributed_notifications@Uv3',
	'com.apple.dock.fullscreen',
	'com.apple.dock.server',
	'com.apple.fonts',
	'com.apple.FSEvents',
	'com.apple.logd',
	'com.apple.logd.events',
	'com.apple.lsd.mapdb',
	'com.apple.lsd.modifydb',
	'com.apple.MenuBarAgent.systemservices',
	'com.apple.PowerManagement.control',
	'com.apple.powerlog.plxpclogger.xpc',
	'com.apple.security.syspolicy',
	'com.apple.security.syspolicy.exec',
	'com.apple.SystemConfiguration.configd',
	'com.apple.SystemConfiguration.DNSConfiguration',
	'com.apple.sysmond',
	'com.apple.system.notification_center',
	'com.apple.system.opendirectoryd.libinfo',
	'com.apple.system.opendirectoryd.membership',
	'com.apple.tccd',
	'com.apple.tccd.system',
	'com.apple.touchbarserver.mig',
	'com.apple.trustd.agent',
	'com.apple.usernotifications.listener',
	'com.apple.ViewBridgeAuxiliary',
	'com.apple.window_proxies',
	'com.apple.windowmanager.server',
	'com.apple.windowserver.active',
];
const KEYCHAIN_SERVICE = 'com.apple.SecurityServer';
const CHROMIUM_RENDEZVOUS = '\\.MachPortRendezvousServer\\.[0-9]+$';
const REGISTERED_SERVICES = ['com.apple.axserver', 'com.apple.coredrag', 'com.apple.tsm.portname'];
const DNS_SOCKET = '/private/var/run/mDNSResponder';
const LOG_SOCKET = '/private/var/run/syslog';
const LAUNCHD_SOCKETS = '^/private/tmp/com\\.apple\\.launchd\\.';
const UNSANDBOXED_TOOLS = ['/bin/ps', '/usr/bin/top', '/usr/bin/log'];
const DENIAL =
	/^(?:\d+ duplicate reports? for )?Sandbox: (.+?)\(\d+\) deny\(\d+\) (\S+)(?: (.+))?$/u;

export type SandboxGrantKind = 'path' | 'socket';

export type SandboxGrant = Readonly<{ kind: SandboxGrantKind; path: string }>;

export type SandboxDenial = Readonly<{
	tag: string;
	process: string;
	operation: string;
	target: string;
}>;

export interface GrantPlaces {
	readonly checkout: string;
	readonly hidden: readonly string[];
}

export interface SandboxPlaces extends GrantPlaces {
	readonly internet: boolean;
	readonly tag?: string;
	readonly grants?: readonly SandboxGrant[];
}

export function claudeChatRecords(
	directory: string = process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude'),
): string[] {
	return CLAUDE_CHAT_RECORDS.map((entry) => join(directory, entry));
}

export type SandboxProblem =
	'unsupported' | 'missing' | 'outdated' | 'blocked' | 'nested' | 'not-set-up';

export interface SandboxRules {
	readonly places: SandboxPlaces;
	readonly home: string;
	readonly temp: string;
	readonly write: readonly string[];
	readonly readOnly: readonly string[];
	readonly closed: readonly string[];
	readonly sockets: readonly string[];
	readonly internet: boolean;
}

export interface SandboxEngine {
	problem(): SandboxProblem | null;
	prefix(rules: SandboxRules): string[];
	denials?(output: string): SandboxDenial[];
}

const seatbelt: SandboxEngine = {
	problem: () => (!existsSync(SANDBOX_EXEC) ? 'missing' : insideASandbox() ? 'nested' : null),
	prefix: ({ places, home, temp }) => [SANDBOX_EXEC, '-p', sandboxProfile(places, home, temp)],
};

const ENGINES: Partial<Record<NodeJS.Platform, SandboxEngine>> = {
	darwin: seatbelt,
	linux: bubblewrap,
	win32: windows,
};

let confined = false;

export function sandboxProblem(): SandboxProblem | null {
	if (confined) return null;
	const engine = ENGINES[process.platform];
	const problem = engine ? engine.problem() : 'unsupported';
	confined = problem === null;
	return problem;
}

export function canSandbox(): boolean {
	return sandboxProblem() === null;
}

export function sandboxDenialsIn(output: string): SandboxDenial[] {
	return ENGINES[process.platform]?.denials?.(output) ?? [];
}

export function sandboxPrefix(
	places: SandboxPlaces,
	home: string = homedir(),
	temp: string = tmpdir(),
): string[] {
	const engine = ENGINES[process.platform];
	if (!engine) throw new Error('Malini cannot confine commands on this computer');
	return engine.prefix(sandboxRules(places, home, temp));
}

export function sandboxRules(
	places: SandboxPlaces,
	home: string = homedir(),
	temp: string = tmpdir(),
	platform: NodeJS.Platform = process.platform,
): SandboxRules {
	const policy = policyFor(platform);
	const root = canonicalPath(places.checkout);
	const closed = closedPlaces(places, home, policy);
	const granted = (places.grants ?? []).filter((grant) => refusal(grant, closed) === null);
	const paths = granted
		.filter(({ kind }) => kind === 'path')
		.map(({ path }) => canonicalPath(path));
	const caches = policy.caches.map((entry) => join(home, entry));
	if (platform !== 'darwin') for (const cache of caches) makeFolder(cache);
	return {
		places,
		home,
		temp,
		write: [root, ...gitFolders(root), ...policy.temp, ...caches, ...paths].map(canonicalPath),
		readOnly: [root, ...paths].flatMap(protectedPaths),
		closed: [
			...closed.secret,
			...closed.userData,
			...(platform === 'darwin' ? [] : [...secretsFolders(temp), ...agentSockets(home, policy)]),
		],
		sockets: granted.filter(({ kind }) => kind === 'socket').map(({ path }) => path),
		internet: places.internet,
	};
}

function protectedPaths(folder: string): string[] {
	const pointer = join(folder, '.git');
	return [
		...gitFolders(folder).flatMap((gitdir) =>
			['hooks', 'config', 'config.worktree', 'commondir', 'gitdir'].map((entry) =>
				join(gitdir, entry),
			),
		),
		...(isFile(pointer) ? [pointer] : []),
		join(folder, '.claude'),
		join(folder, '.mcp.json'),
	];
}

function agentSockets(home: string, policy: Policy): string[] {
	const bus = /path=([^,]+)/u.exec(process.env['DBUS_SESSION_BUS_ADDRESS'] ?? '')?.[1];
	return [process.env['SSH_AUTH_SOCK'], bus].flatMap((socket) => {
		if (!socket || !isAbsolute(socket)) return [];
		const folder = dirname(socket);
		return [socket, ...(isSharedFolder(folder, home, policy) ? [] : [folder])];
	});
}

function secretsFolders(temp: string): string[] {
	try {
		return readdirSync(temp)
			.filter((name) => name.startsWith(SECRETS_FOLDER_PREFIX))
			.map((name) => canonicalPath(join(temp, name)));
	} catch {
		return [];
	}
}

function makeFolder(path: string): void {
	try {
		mkdirSync(path, { recursive: true });
	} catch {
		return;
	}
}

function insideASandbox(): boolean {
	const probe = spawnSync(SANDBOX_EXEC, ['-p', '(version 1)(allow default)', '/usr/bin/true'], {
		encoding: 'utf8',
	});
	return probe.status !== 0 && probe.stderr.includes('sandbox_apply: Operation not permitted');
}

export function sandboxedCommand(
	places: SandboxPlaces,
	file: string,
	args: readonly string[],
	home: string = homedir(),
	temp: string = tmpdir(),
): readonly [file: string, args: string[]] {
	const [first = '', ...rest] = sandboxPrefix(places, home, temp);
	return [first, [...rest, file, ...args]];
}

export function sandboxProfile(
	{ checkout, hidden, internet, tag, grants = [] }: SandboxPlaces,
	home: string = homedir(),
	temp: string = tmpdir(),
): string {
	const root = canonicalPath(checkout);
	const git = gitFolders(root);
	const closed = closedPlaces({ checkout, hidden }, home, POLICIES.darwin);
	const granted = grants.filter((grant) => refusal(grant, closed) === null);
	const grantedPaths = granted.filter(({ kind }) => kind === 'path').map(({ path }) => path);
	const grantedSockets = granted.filter(({ kind }) => kind === 'socket').map(({ path }) => path);
	const writable = [
		root,
		...git,
		...TEMP_FOLDERS,
		...CACHES.map((entry) => join(home, entry)),
		...grantedPaths,
	];
	const pnpmLinkProbes = regex(`^${escapeRegex(canonicalPath(join(home, PNPM_LINK_PROBES)))}`);
	const sockets = [
		...[root, ...TEMP_FOLDERS, ...grantedPaths].map((path) => subpath(canonicalPath(path))),
		...[DNS_SOCKET, LOG_SOCKET, ...grantedSockets].map(literal),
	];
	const secret = [...CREDENTIALS.map((entry) => join(home, entry)), ...hidden];
	const userData = USER_DATA.map((entry) => join(home, entry));
	return [
		'(version 1)',
		tag ? `(deny default (with message ${quoted(tag)}))` : '(deny default)',
		'(allow process-exec process-fork)',
		`(allow process-exec (with no-sandbox) ${UNSANDBOXED_TOOLS.map(literal).join(' ')})`,
		'(allow process-info* signal mach-priv-task-port (target same-sandbox))',
		'(allow process-info*)',
		'(allow sysctl-read system-info)',
		'(allow sysctl-write (sysctl-name "kern.tcsm_enable"))',
		'(allow file-read* file-ioctl file-map-executable)',
		`(allow file-write* ${[...writable.map((path) => subpath(canonicalPath(path))), pnpmLinkProbes, ...DEVICES].join(' ')})`,
		`(deny file-write* ${ranOutside(root, git, grantedPaths.map(canonicalPath)).join(' ')})`,
		`(deny file-read* file-write* ${[...secret.map((path) => subpath(canonicalPath(path))), ...userData.map((path) => subpath(canonicalPath(path))), regex(`^${escapeRegex(canonicalPath(temp))}/${escapeRegex(SECRETS_FOLDER_PREFIX)}[0-9]+-`)].join(' ')})`,
		`(allow mach-lookup ${[...SERVICES, ...(internet ? [KEYCHAIN_SERVICE] : [])].map(globalName).join(' ')} (global-name-regex ${quoted(CHROMIUM_RENDEZVOUS)}))`,
		`(allow mach-register (global-name-regex ${quoted(CHROMIUM_RENDEZVOUS)}) ${REGISTERED_SERVICES.flatMap((name) => [globalName(name), `(local-name ${quoted(name)})`]).join(' ')})`,
		'(allow ipc-posix-shm ipc-posix-sem)',
		'(allow iokit-open iokit-get-properties)',
		'(allow user-preference-read)',
		'(allow system-socket)',
		'(allow pseudo-tty)',
		'(allow distributed-notification-post)',
		'(allow network-bind network-inbound (local ip "localhost:*") (local unix-socket))',
		`(allow network-outbound (remote ip "localhost:*") ${sockets.map((socket) => `(remote unix-socket ${socket})`).join(' ')})`,
		`(deny network-outbound (remote unix-socket ${regex(LAUNCHD_SOCKETS)}))`,
		...(internet ? ['(allow network-outbound (remote ip "*:*"))'] : []),
		'',
	].join('\n');
}

export function sandboxDenial(message: string): SandboxDenial | null {
	const split = message.lastIndexOf('\n');
	const tag = message.slice(split + 1).trim();
	const match = DENIAL.exec(message.slice(0, split).trim());
	if (split < 0 || !match || !tag.startsWith(SANDBOX_TAG_PREFIX)) return null;
	const [, process = '', operation = '', target = ''] = match;
	return { tag, process, operation, target };
}

export function sandboxGrant(
	{ operation, target }: SandboxDenial,
	places: GrantPlaces,
	home: string = homedir(),
	platform: NodeJS.Platform = process.platform,
): SandboxGrant | null {
	if (!isAbsolute(target)) return null;
	const closed = closedPlaces(places, home, policyFor(platform));
	const grant: SandboxGrant | null = operation.startsWith('file-write')
		? { kind: 'path', path: grantFolder(target, closed) }
		: operation === 'network-outbound'
			? { kind: 'socket', path: target }
			: null;
	return grant && refusal(grant, closed) === null ? grant : null;
}

export function toolStateGrant(
	denial: SandboxDenial,
	places: GrantPlaces,
	home: string = homedir(),
	platform: NodeJS.Platform = process.platform,
): SandboxGrant | null {
	const grant = denial.operation.startsWith('file-write')
		? sandboxGrant(denial, places, home, platform)
		: null;
	const policy = policyFor(platform);
	return grant?.kind === 'path' &&
		isToolState(grant.path, denial.target, denial.process, home, policy)
		? grant
		: null;
}

function isToolState(
	path: string,
	target: string,
	process: string,
	home: string,
	policy: Policy,
): boolean {
	if (path === target && !isDirectory(path)) return false;
	const canonical = canonicalPath(path);
	const folder = canonicalPath(home);
	const within = (root: string) => isWithin(root, canonical, policy.separator);
	if (!within(folder)) return policy.temp.some((temp) => within(canonicalPath(temp)));
	const leaf = leafOf(canonical, folder, policy);
	if (!leaf.includes('/')) return leaf.startsWith('.');
	const named = policy.toolStateNamed.find((prefix) => leaf.startsWith(prefix));
	if (named !== undefined) {
		const app = leaf.slice(named.length);
		if (!app.includes('/')) return app.toLowerCase() === process.toLowerCase();
	}
	if (policy.caches.some((cache) => within(canonicalPath(join(home, cache))))) return true;
	const any = policy.toolStateAny.find((prefix) => leaf.startsWith(prefix));
	return any !== undefined && !leaf.slice(any.length).includes('/');
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

export function grantProblem(
	grant: SandboxGrant,
	places: GrantPlaces,
	home: string = homedir(),
	platform: NodeJS.Platform = process.platform,
): string | null {
	return refusal(grant, closedPlaces(places, home, policyFor(platform)));
}

interface ClosedPlaces {
	readonly home: string;
	readonly policy: Policy;
	readonly checkout: readonly string[];
	readonly malini: readonly string[];
	readonly secret: readonly string[];
	readonly userData: readonly string[];
	readonly runOutsideLater: readonly string[];
	readonly keyAgents: readonly string[];
}

function closedPlaces(
	{ checkout, hidden }: GrantPlaces,
	home: string,
	policy: Policy,
): ClosedPlaces {
	const root = canonicalPath(checkout);
	const inHome = (entries: readonly string[]) =>
		entries.map((entry) => canonicalPath(join(home, entry)));
	const hiddenPaths = hidden.map(canonicalPath);
	const agent = process.env['SSH_AUTH_SOCK'];
	const appData = process.env[APP_DATA_ROOT];
	return {
		home: canonicalPath(home),
		policy,
		checkout: [root, ...gitFolders(root)],
		malini: appData && isAbsolute(appData) ? [canonicalPath(appData)] : [],
		secret: [...inHome(policy.credentials), ...hiddenPaths],
		userData: inHome(policy.userData),
		runOutsideLater: inHome(policy.runOutsideLater),
		keyAgents: [
			...inHome(KEY_AGENTS),
			...hiddenPaths,
			...(agent && isAbsolute(agent) ? [canonicalPath(agent)] : []),
		],
	};
}

function refusal({ kind, path }: SandboxGrant, closed: ClosedPlaces): string | null {
	const separator = closed.policy.separator;
	if (
		!isAbsolute(path) ||
		normalize(path) !== path ||
		path.includes('\0') ||
		(path.endsWith(separator) && dirname(path) !== path)
	) {
		return 'is not an absolute, normalized path';
	}
	if (path.split(separator).some((part) => part.startsWith(SECRETS_FOLDER_PREFIX))) {
		return "holds Malini's secrets";
	}
	const within = (roots: readonly string[]) =>
		roots.some((root) => isWithin(root, path, separator));
	if (kind === 'socket') {
		return within(closed.keyAgents) || new RegExp(LAUNCHD_SOCKETS, 'u').test(path)
			? 'reaches a key agent'
			: null;
	}
	if (isSharedFolder(path, closed.home, closed.policy)) return 'is a folder every app shares';
	const holds = (roots: readonly string[]) => roots.some((root) => isWithin(path, root, separator));
	if (within(closed.checkout)) return 'is in the checkout, which stays protected';
	if (holds(closed.checkout)) return 'holds the checkout';
	if (within(closed.malini) || holds(closed.malini)) return "holds Malini's own data";
	if (within(closed.secret) || holds(closed.secret)) return 'holds credentials';
	if (within(closed.userData) || holds(closed.userData)) return 'holds your files';
	if (within(closed.runOutsideLater)) return 'runs outside the sandbox later';
	return null;
}

function grantFolder(target: string, closed: ClosedPlaces): string {
	const guarded = [...closed.secret, ...closed.userData];
	const stops = (folder: string) =>
		isSharedFolder(folder, closed.home, closed.policy) ||
		guarded.some((root) => isWithin(folder, root, closed.policy.separator));
	let child = target;
	let parent = dirname(target);
	while (parent !== child && !stops(parent)) {
		child = parent;
		parent = dirname(parent);
	}
	return child;
}

function isSharedFolder(folder: string, home: string, policy: Policy): boolean {
	if (dirname(folder) === folder || policy.sharedFolders.includes(folder)) return true;
	if (!isWithin(home, folder, policy.separator)) return false;
	const inHome = leafOf(folder, home, policy);
	return (
		policy.sharedHomeFolders.includes(inHome) ||
		policy.sharedHomeParents.includes(dirname(inHome)) ||
		(!inHome.includes('/') && !inHome.startsWith('.'))
	);
}

function leafOf(path: string, home: string, policy: Policy): string {
	return path
		.slice(home.length + 1)
		.split(policy.separator)
		.join('/');
}

function isWithin(root: string, path: string, separator: '/' | '\\' = '/'): boolean {
	if (path === root) return true;
	return path.startsWith(dirname(root) === root ? root : `${root}${separator}`);
}

function gitFolders(checkout: string): string[] {
	const dotGit = join(checkout, '.git');
	const link = /^gitdir:\s*(.+)$/mu.exec(readText(dotGit) ?? '')?.[1];
	const gitdir = link ? resolve(checkout, link.trim()) : dotGit;
	const common = readText(join(gitdir, 'commondir'))?.trim();
	return [...new Set([gitdir, common ? resolve(gitdir, common) : gitdir].map(canonicalPath))];
}

const GIT_POINTERS = '(config(\\.worktree)?|commondir|gitdir)';

function ranOutside(
	checkout: string,
	git: readonly string[],
	granted: readonly string[],
): string[] {
	return [
		...git.flatMap((folder) => [
			regex(`^${escapeRegex(folder)}/(.+/)?hooks(/|$)`),
			regex(`^${escapeRegex(folder)}/(.+/)?${GIT_POINTERS}$`),
		]),
		literal(join(checkout, '.git')),
		regex(`^${escapeRegex(checkout)}/\\.claude/settings(\\.local)?\\.json$`),
		literal(join(checkout, '.mcp.json')),
		...granted.flatMap((folder) => [
			regex(`^${escapeRegex(folder)}/(.+/)?\\.git/(.+/)?(hooks(/|$)|${GIT_POINTERS}$)`),
			regex(`^${escapeRegex(folder)}/(.+/)?\\.claude/settings(\\.local)?\\.json$`),
			regex(`^${escapeRegex(folder)}/(.+/)?\\.mcp\\.json$`),
		]),
	];
}

function readText(path: string): string | null {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return null;
	}
}

function canonicalPath(path: string): string {
	try {
		return realpathSync.native(path);
	} catch {
		const parent = dirname(path);
		return parent === path ? path : join(canonicalPath(parent), basename(path));
	}
}

function subpath(path: string): string {
	return `(subpath ${quoted(path)})`;
}

function literal(path: string): string {
	return `(literal ${quoted(path)})`;
}

function regex(pattern: string): string {
	return `(regex ${quoted(pattern)})`;
}

function globalName(name: string): string {
	return `(global-name ${quoted(name)})`;
}

function quoted(text: string): string {
	return `"${text.replace(/[\\"]/gu, '\\$&')}"`;
}

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
