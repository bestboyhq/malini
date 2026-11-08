import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'node:path';

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

let applies: boolean | undefined;

export function canSandbox(): boolean {
	applies ??= process.platform === 'darwin' && existsSync(SANDBOX_EXEC) && !insideASandbox();
	return applies;
}

function insideASandbox(): boolean {
	const probe = spawnSync(SANDBOX_EXEC, ['-p', '(version 1)(allow default)', '/usr/bin/true'], {
		encoding: 'utf8',
	});
	return probe.status !== 0 && probe.stderr.includes('sandbox_apply: Operation not permitted');
}

export function sandboxedCommand(
	profile: string,
	file: string,
	args: readonly string[],
): readonly [file: string, args: string[]] {
	return [SANDBOX_EXEC, ['-p', profile, file, ...args]];
}

export function sandboxProfile(
	{ checkout, hidden, internet, tag, grants = [] }: SandboxPlaces,
	home: string = homedir(),
	temp: string = tmpdir(),
): string {
	const root = canonicalPath(checkout);
	const git = gitFolders(root);
	const closed = closedPlaces({ checkout, hidden }, home);
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
		...[DNS_SOCKET, ...grantedSockets].map(literal),
	];
	const secret = [...CREDENTIALS.map((entry) => join(home, entry)), ...hidden];
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
		`(deny file-read* file-write* ${[...secret.map((path) => subpath(canonicalPath(path))), regex(`^${escapeRegex(canonicalPath(temp))}/${escapeRegex(SECRETS_FOLDER_PREFIX)}[0-9]+-`)].join(' ')})`,
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
): SandboxGrant | null {
	if (!isAbsolute(target)) return null;
	const grant: SandboxGrant | null = operation.startsWith('file-write')
		? { kind: 'path', path: grantFolder(target, home) }
		: operation === 'network-outbound'
			? { kind: 'socket', path: target }
			: null;
	return grant && grantProblem(grant, places, home) === null ? grant : null;
}

export function grantProblem(
	grant: SandboxGrant,
	places: GrantPlaces,
	home: string = homedir(),
): string | null {
	return refusal(grant, closedPlaces(places, home));
}

interface ClosedPlaces {
	readonly home: string;
	readonly checkout: readonly string[];
	readonly malini: readonly string[];
	readonly secret: readonly string[];
	readonly runOutsideLater: readonly string[];
	readonly keyAgents: readonly string[];
}

function closedPlaces({ checkout, hidden }: GrantPlaces, home: string): ClosedPlaces {
	const root = canonicalPath(checkout);
	const inHome = (entries: readonly string[]) =>
		entries.map((entry) => canonicalPath(join(home, entry)));
	const hiddenPaths = hidden.map(canonicalPath);
	const agent = process.env['SSH_AUTH_SOCK'];
	const appData = process.env[APP_DATA_ROOT];
	return {
		home: canonicalPath(home),
		checkout: [root, ...gitFolders(root)],
		malini: appData && isAbsolute(appData) ? [canonicalPath(appData)] : [],
		secret: [...inHome(CREDENTIALS), ...hiddenPaths],
		runOutsideLater: inHome(RUN_OUTSIDE_LATER),
		keyAgents: [
			...inHome(KEY_AGENTS),
			...hiddenPaths,
			...(agent && isAbsolute(agent) ? [canonicalPath(agent)] : []),
		],
	};
}

function refusal({ kind, path }: SandboxGrant, closed: ClosedPlaces): string | null {
	if (!isAbsolute(path) || normalize(path) !== path || path.includes('\0') || path.endsWith('/')) {
		return 'is not an absolute, normalized path';
	}
	if (path.split('/').some((part) => part.startsWith(SECRETS_FOLDER_PREFIX))) {
		return "holds Malini's secrets";
	}
	const within = (roots: readonly string[]) => roots.some((root) => isWithin(root, path));
	if (kind === 'socket') {
		return within(closed.keyAgents) || new RegExp(LAUNCHD_SOCKETS, 'u').test(path)
			? 'reaches a key agent'
			: null;
	}
	if (isSharedFolder(path, closed.home)) return 'is a folder every app shares';
	if (within(closed.checkout)) return 'is in the checkout, which stays protected';
	if (closed.checkout.some((root) => isWithin(path, root))) return 'holds the checkout';
	if (within(closed.malini) || closed.malini.some((root) => isWithin(path, root))) {
		return "holds Malini's own data";
	}
	if (within(closed.secret)) return 'holds credentials';
	if (within(closed.runOutsideLater)) return 'runs outside the sandbox later';
	return null;
}

function grantFolder(target: string, home: string): string {
	const shared = canonicalPath(home);
	let child = target;
	let parent = dirname(target);
	while (parent !== child && !isSharedFolder(parent, shared)) {
		child = parent;
		parent = dirname(parent);
	}
	return child;
}

function isSharedFolder(folder: string, home: string): boolean {
	if (SHARED_FOLDERS.includes(folder)) return true;
	if (!isWithin(home, folder)) return false;
	const inHome = folder.slice(home.length + 1);
	return (
		SHARED_HOME_FOLDERS.includes(inHome) ||
		dirname(inHome) === 'Library' ||
		(!inHome.includes('/') && !inHome.startsWith('.'))
	);
}

function isWithin(root: string, path: string): boolean {
	return path === root || path.startsWith(root === '/' ? '/' : `${root}/`);
}

function gitFolders(checkout: string): string[] {
	const dotGit = join(checkout, '.git');
	const link = /^gitdir:\s*(.+)$/mu.exec(readText(dotGit) ?? '')?.[1];
	const gitdir = link ? resolve(checkout, link.trim()) : dotGit;
	const common = readText(join(gitdir, 'commondir'))?.trim();
	return [...new Set([gitdir, common ? resolve(gitdir, common) : gitdir].map(canonicalPath))];
}

function ranOutside(
	checkout: string,
	git: readonly string[],
	granted: readonly string[],
): string[] {
	return [
		...git.flatMap((folder) => [
			regex(`^${escapeRegex(folder)}/(.+/)?hooks(/|$)`),
			regex(`^${escapeRegex(folder)}/(.+/)?config(\\.worktree)?$`),
		]),
		regex(`^${escapeRegex(checkout)}/\\.claude/settings(\\.local)?\\.json$`),
		literal(join(checkout, '.mcp.json')),
		...granted.flatMap((folder) => [
			regex(`^${escapeRegex(folder)}/(.+/)?\\.git/(.+/)?(hooks(/|$)|config(\\.worktree)?$)`),
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
		return realpathSync(path);
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
