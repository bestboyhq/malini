import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
export const SECRETS_FOLDER_PREFIX = 'malini-secrets-';
export const OUTSIDE_THE_SANDBOX = 'malini-outside-';
export const SANDBOX_ENVIRONMENT = { ELECTRON_DISABLE_SANDBOX: '1' } as const;

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

const CACHES = ['Library/Caches', '.cache', '.npm', 'Library/pnpm/store'];
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
const ELECTRON_RENDEZVOUS = 'com.github.Electron.MachPortRendezvousServer.';
const REGISTERED_SERVICES = ['com.apple.axserver', 'com.apple.coredrag', 'com.apple.tsm.portname'];
const DNS_SOCKET = '/private/var/run/mDNSResponder';
const LAUNCHD_SOCKETS = '^/private/tmp/com\\.apple\\.launchd\\.';
const UNSANDBOXED_TOOLS = ['/bin/ps', '/usr/bin/top'];

export interface SandboxPlaces {
	readonly checkout: string;
	readonly hidden: readonly string[];
	readonly internet: boolean;
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
	{ checkout, hidden, internet }: SandboxPlaces,
	home: string = homedir(),
	temp: string = tmpdir(),
): string {
	const root = canonicalPath(checkout);
	const git = gitFolders(root);
	const writable = [root, ...git, ...TEMP_FOLDERS, ...CACHES.map((entry) => join(home, entry))];
	const sockets = [...[root, ...TEMP_FOLDERS].map(subpath), literal(DNS_SOCKET)];
	const secret = [...CREDENTIALS.map((entry) => join(home, entry)), ...hidden];
	return [
		'(version 1)',
		'(deny default)',
		'(allow process-exec process-fork)',
		`(allow process-exec (with no-sandbox) ${UNSANDBOXED_TOOLS.map(literal).join(' ')})`,
		'(allow process-info* signal mach-priv-task-port (target same-sandbox))',
		'(allow process-info*)',
		'(allow sysctl-read system-info)',
		'(allow sysctl-write (sysctl-name "kern.tcsm_enable"))',
		'(allow file-read* file-ioctl file-map-executable)',
		`(allow file-write* ${[...writable.map((path) => subpath(canonicalPath(path))), ...DEVICES].join(' ')})`,
		`(deny file-write* ${ranOutside(root, git).join(' ')})`,
		`(deny file-read* file-write* ${[...secret.map((path) => subpath(canonicalPath(path))), regex(`^${escapeRegex(canonicalPath(temp))}/${escapeRegex(SECRETS_FOLDER_PREFIX)}[0-9]+-`)].join(' ')})`,
		`(allow mach-lookup ${[...SERVICES, ...(internet ? [KEYCHAIN_SERVICE] : [])].map(globalName).join(' ')} (global-name-prefix ${quoted(ELECTRON_RENDEZVOUS)}))`,
		`(allow mach-register (global-name-prefix ${quoted(ELECTRON_RENDEZVOUS)}) ${REGISTERED_SERVICES.flatMap((name) => [globalName(name), `(local-name ${quoted(name)})`]).join(' ')})`,
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

function gitFolders(checkout: string): string[] {
	const dotGit = join(checkout, '.git');
	const link = /^gitdir:\s*(.+)$/mu.exec(readText(dotGit) ?? '')?.[1];
	const gitdir = link ? resolve(checkout, link.trim()) : dotGit;
	const common = readText(join(gitdir, 'commondir'))?.trim();
	return [...new Set([gitdir, common ? resolve(gitdir, common) : gitdir].map(canonicalPath))];
}

function ranOutside(checkout: string, git: readonly string[]): string[] {
	return [
		...git.flatMap((folder) => [
			regex(`^${escapeRegex(folder)}/(.+/)?hooks(/|$)`),
			regex(`^${escapeRegex(folder)}/(.+/)?config(\\.worktree)?$`),
		]),
		regex(`^${escapeRegex(checkout)}/\\.claude/settings(\\.local)?\\.json$`),
		literal(join(checkout, '.mcp.json')),
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
