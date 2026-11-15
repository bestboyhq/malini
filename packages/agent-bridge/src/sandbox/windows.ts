import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, win32 } from 'node:path';
import type * as HttpProxy from '@anthropic-ai/sandbox-runtime/dist/sandbox/http-proxy.js';
import type * as MuxProxy from '@anthropic-ai/sandbox-runtime/dist/sandbox/mux-proxy.js';
import type * as SocksProxy from '@anthropic-ai/sandbox-runtime/dist/sandbox/socks-proxy.js';
import type * as Utils from '@anthropic-ai/sandbox-runtime/dist/sandbox/windows-sandbox-utils.js';
import { BRIDGE_SANDBOX_SCRATCH_PATH } from '../generated/protocol-contract.js';
import type { SandboxDenial, SandboxEngine, SandboxProblem, SandboxRules } from '../sandbox.js';

export const SANDBOX_RUNTIME = 'MALINI_SANDBOX_RUNTIME';

export type WindowsSetupOutcome =
	| { readonly outcome: 'done' | 'cancelled' | 'conflict' | 'busy' }
	| { readonly outcome: 'failed'; readonly reason: string };

interface Runtime {
	readonly utils: typeof Utils;
	readonly http: typeof HttpProxy;
	readonly socks: typeof SocksProxy;
	readonly mux: typeof MuxProxy;
	readonly srtWin: Utils.SrtWinSpawn;
	readonly git: string;
	readonly bash: string;
}

interface Network {
	readonly port: number;
	readonly token: string;
}

const BASH = join('usr', 'bin', 'bash.exe');
const FOLDER_PLACEHOLDERS = new Set(['.claude', '.mcp.json', 'hooks']);
const UNPROTECTABLE = new Set(['commondir', 'gitdir']);
const REPOSITORY_FILES = new Set(['.claude', '.mcp.json']);
const BUSY: ReadonlySet<string> = new Set([
	'profile_grant_blocked_by_session',
	'kept_grants_in_use',
	'profile_operation_in_progress',
]);
const CANCELLED = 10;
const DENIED =
	/permission denied|operation not permitted|access is denied|access to the path .+ is denied|\bE(?:PERM|ACCES)\b/iu;
const PATHS =
	/'([^']+)'|"([^"]+)"|`([^`]+)`|‘([^’]+)’|((?:[A-Za-z]:[\\/]|\/[A-Za-z]\/)[^\s'"`:]*)/gu;
const WROTE = /^([a-z][\w.+-]+):/u;
const MSYS_DRIVE = /^\/([A-Za-z])\/(.*)$/u;
const DRIVE_PATH = /^[A-Za-z]:[\\/]/u;
const PROGRESS = /(\d+)\s*\/\s*(\d+)/u;
const OWN_VARIABLES = [
	'USERPROFILE',
	'HOME',
	'HOMEDRIVE',
	'HOMEPATH',
	'APPDATA',
	'LOCALAPPDATA',
	'TEMP',
	'TMP',
	'TMPDIR',
	'USERNAME',
	'USERDOMAIN',
	'USERDOMAIN_ROAMINGPROFILE',
	'LOGONSERVER',
	'PWD',
	'OLDPWD',
	'SHLVL',
	'_',
	'SHELLOPTS',
	'BASHOPTS',
	'BASH*',
	'UID',
	'EUID',
	'PPID',
	'NODE_USE_ENV_PROXY',
	'GIT_CONFIG_COUNT',
	'GIT_CONFIG_KEY_*',
	'GIT_CONFIG_VALUE_*',
	'GIT_CONFIG_PARAMETERS',
	'CLOUDSDK_PROXY_*',
	'*_PROXY',
];
const FORWARDER = `key=$1 tmp=$2
shift 3
until [ -e "$key.ready" ] || [ -e "$key.failed" ] || [ ! -d "\${key%/*}" ]; do /usr/bin/sleep 0.1; done
if [ ! -e "$key.ready" ]; then
	line='the sandbox is not ready'
	[ -e "$key.failed" ] && IFS= read -r line < "$key.failed"
	printf 'malini: %s, so this command did not run\\n' "$line" >&2
	exit 125
fi
srt=()
while IFS= read -r -d '' word; do srt+=("$word"); done < "$key.ready"
for folder in "\${tmp%/*/*}" "\${tmp%/*}" "$tmp"; do
	if [ -L "$folder" ]; then
		printf 'malini: %s is a link, so this command did not run\\n' "$folder" >&2
		exit 125
	fi
done
/usr/bin/mkdir -p -- "$tmp" || exit 125
file=$tmp/command-$$-$RANDOM$RANDOM
mapfile -t names < <(compgen -e)
shopt -s nocasematch
set -C
{
	printf '/usr/bin/rm -f -- "$1"\\n'
	for name in "\${names[@]}"; do
		case $name in
		${OWN_VARIABLES.join('|')}) ;;
		*) printf 'export %s=%q\\n' "$name" "\${!name}" ;;
		esac
	done
	printf 'exec'
	printf ' %q' "$@"
	printf '\\n'
} > "$file" || exit 125
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' exec "\${srt[@]}" malini "$file"
`;

export const windows: SandboxEngine = { problem, prefix, denials };

let loaded: Runtime | undefined;
let preparations: string | undefined;
let exitHooked = false;
let granted: string | undefined;
let verifying: Promise<unknown> | undefined;
let network: Promise<Network> | undefined;
const started = new Set<string>();

export function windowsRuntime(): Runtime | null {
	try {
		loaded ??= loadRuntime();
		return loaded;
	} catch {
		return null;
	}
}

function loadRuntime(): Runtime {
	const root =
		process.env[SANDBOX_RUNTIME] ||
		dirname(createRequire(import.meta.url).resolve('@anthropic-ai/sandbox-runtime/package.json'));
	const load = createRequire(join(root, 'package.json'));
	const utils: typeof Utils = load('./dist/sandbox/windows-sandbox-utils.js');
	const chip = process.arch === 'arm64' ? 'arm64' : 'x64';
	const git = gitRoot();
	return {
		utils,
		http: load('./dist/sandbox/http-proxy.js'),
		socks: load('./dist/sandbox/socks-proxy.js'),
		mux: load('./dist/sandbox/mux-proxy.js'),
		srtWin: utils.resolveSrtWin({ path: join(root, 'vendor', 'srt-win', chip, 'srt-win.exe') }),
		git,
		bash: join(git, BASH),
	};
}

function gitRoot(): string {
	const launcher = process.env['CLAUDE_CODE_GIT_BASH_PATH'];
	const roots = [
		...(launcher ? [dirname(dirname(launcher)), dirname(dirname(dirname(launcher)))] : []),
		join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Git'),
	];
	const root = roots.find((folder) => win32.isAbsolute(folder) && existsSync(join(folder, BASH)));
	if (root === undefined) throw new Error('Git Bash is missing');
	return root;
}

function problem(): SandboxProblem | null {
	const runtime = windowsRuntime();
	if (!runtime) return 'missing';
	const { utils, srtWin } = runtime;
	let status: Utils.WindowsSandboxStatus;
	try {
		status = utils.checkWindowsSandboxStatus({ srtWin });
	} catch {
		return 'blocked';
	}
	const { user, wfp } = status;
	if (!user.provisioned || !user.credPresent || !user.sid) return 'not-set-up';
	if (utils.windowsSetupVersionMismatch(user)) return 'outdated';
	if (user.seclogon === 'disabled' || user.seclogon === 'missing') return 'blocked';
	if (utils.missingWindowsSrtWinCapability(user.capabilities)) return 'outdated';
	if (wfp.state === 'absent' || wfp.state === 'loopback-mismatch' || !wfp.allowLoopback) {
		return 'not-set-up';
	}
	if (user.profileGrant?.state !== 'present') return 'not-set-up';
	try {
		const profile = utils.getWindowsProfileReadStatus({ srtWin }).state;
		return profile === 'current' ? null : profile === 'outdated' ? 'outdated' : 'not-set-up';
	} catch {
		return 'not-set-up';
	}
}

function prefix(rules: SandboxRules): string[] {
	const runtime = windowsRuntime();
	if (!runtime) throw new Error('Malini cannot confine commands on this computer');
	const folder = preparationFolder(runtime);
	const digest = createHash('sha256').update(JSON.stringify(rules)).digest('hex');
	const key = join(folder, digest.slice(0, 32));
	if (!started.has(key)) {
		started.add(key);
		rmSync(`${key}.failed`, { force: true });
		void prepare(runtime, rules, key);
	}
	const scratch = windowsSandboxTemp(rules.places.checkout);
	return [...[runtime.bash, join(folder, 'forwarder.sh'), key, scratch].map(mixed), '--'];
}

export function windowsSandboxTemp(checkout: string): string {
	return join(checkout, BRIDGE_SANDBOX_SCRATCH_PATH, 'tmp');
}

function preparationFolder(runtime: Runtime): string {
	if (preparations) return preparations;
	const folder = join(tmpdir(), `malini-srt-${process.pid}`);
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, 'forwarder.sh'), FORWARDER);
	if (!exitHooked) process.once('exit', () => release(runtime));
	exitHooked = true;
	preparations = folder;
	return folder;
}

function release({ utils, srtWin }: Runtime): void {
	if (preparations) rmSync(preparations, { recursive: true, force: true });
	preparations = undefined;
	verifying = undefined;
	started.clear();
	if (granted === undefined) return;
	const holder = { sandboxUserSid: granted, srtWin };
	granted = undefined;
	if (utils.revokeWindowsAclChecked(holder).complete) utils.restoreWindowsAcl(holder);
}

async function prepare(runtime: Runtime, rules: SandboxRules, key: string): Promise<void> {
	try {
		const [program = '', ...words] = await wrap(runtime, rules);
		settle(`${key}.ready`, `${[mixed(program), ...words].join('\0')}\0`);
	} catch (error) {
		started.delete(key);
		settle(`${key}.failed`, `the sandbox could not start: ${firstLine(error)}\n`);
	}
}

async function wrap(runtime: Runtime, rules: SandboxRules): Promise<string[]> {
	const { utils, srtWin, git, bash } = runtime;
	const user = await utils.getWindowsSandboxUserStatusAsync({ srtWin });
	const sid = user.sid;
	if (!user.provisioned || sid === undefined) throw new Error('the sandbox account is not set up');
	const profile = await utils.getWindowsProfileReadStatusAsync({ srtWin });
	const tools = [dirname(srtWin.exe), git];
	const access = utils.rankWindowsFsAccess({
		allowRead: expand(
			utils,
			tools.filter((tool) => inside(rules.home, tool)),
			'grant',
		),
		allowWrite: expand(utils, rules.write, 'grant'),
		denyRead: expand(
			utils,
			rules.closed.filter((path) => existsSync(path)),
			'deny',
		),
		denyWrite: expand(utils, rules.readOnly.flatMap(protectable), 'deny'),
		credentialDeny: [],
	});
	const exposed = tools.find((tool) => access.grantWrite.some((root) => inside(root, tool)));
	if (exposed !== undefined) throw new Error(`${exposed} is in a folder that commands can write`);
	const [conflict] = [
		...utils.windowsProfileExclusionConflicts(access.grantRead, profile),
		...utils.windowsProfileExclusionConflicts(access.grantWrite, profile, { write: true }),
	];
	if (conflict)
		throw new Error(`${conflict.path} reaches ${conflict.exclusion}, which stays closed`);
	await utils.grantWindowsAclPersistent({
		sandboxUserSid: sid,
		read: access.grantRead,
		write: access.grantWrite,
		denyRead: access.denyRead,
		denyWrite: access.denyWrite,
		srtWin,
	});
	granted = sid;
	await fenced(runtime, access.grantWrite);
	const proxy = rules.internet ? await internet(runtime) : null;
	return utils.wrapCommandWithSandboxWindows({
		command: '. "$1"',
		binShell: utils.parseWindowsBinShell({ exe: bash, args: ['-c'] }),
		heldBy: process.pid,
		allowLoopback: true,
		writeRoots: access.grantWrite,
		allowWrite: access.grantWrite,
		cwd: rules.places.checkout,
		setEnvVars: {
			...utils.windowsProfileReadEnv(profile, process.env),
			npm_config_package_import_method: 'copy',
			UV_LINK_MODE: 'copy',
		},
		srtWin,
		quiet: true,
		...(proxy
			? { httpProxyPort: proxy.port, socksProxyPort: proxy.port, proxyAuthToken: proxy.token }
			: {}),
	}).argv;
}

async function fenced(runtime: Runtime, writeRoots: readonly string[]): Promise<void> {
	verifying ??= runtime.utils.verifyWindowsWfpEgress({
		allowLoopback: true,
		writeRoots,
		srtWin: runtime.srtWin,
	});
	try {
		await verifying;
	} catch (error) {
		verifying = undefined;
		throw error;
	}
}

async function internet(runtime: Runtime): Promise<Network> {
	network ??= openNetwork(runtime);
	try {
		return await network;
	} catch (error) {
		network = undefined;
		throw error;
	}
}

async function openNetwork({ http, socks, mux }: Runtime): Promise<Network> {
	const token = randomBytes(16).toString('hex');
	const everywhere = () => true;
	const socksServer = socks.createSocksProxyServer({ filter: everywhere, proxyAuthToken: token });
	const proxy = mux.createMuxProxyServer({
		httpServer: http.createHttpProxyServer({ filter: everywhere, proxyAuthToken: token }),
		handleSocksConnection: (socket) => socksServer.handleConnection(socket),
	});
	await proxy.listenHttpBackend();
	proxy.server.listen(0, '127.0.0.1');
	await once(proxy.server, 'listening');
	proxy.unref();
	const port = proxy.getPort();
	if (port === undefined) throw new Error('the network proxy did not start');
	return { port, token };
}

function expand(utils: typeof Utils, paths: readonly string[], mode: 'grant' | 'deny'): string[] {
	return utils.expandWindowsFsPaths(
		paths.map((path) => ({ path, literal: true }) as const),
		{ mode },
	);
}

function protectable(path: string): string[] {
	if (existsSync(path)) return [path];
	const name = basename(path);
	const parent = dirname(path);
	if (UNPROTECTABLE.has(name) || !isFolder(parent)) return [];
	if (REPOSITORY_FILES.has(name) && !existsSync(join(parent, '.git'))) return [];
	return [FOLDER_PLACEHOLDERS.has(name) ? `${path}${win32.sep}` : path];
}

function inside(root: string, path: string): boolean {
	const relative = win32.relative(root, path);
	return (
		relative === '' ||
		(relative !== '..' && !relative.startsWith(`..${win32.sep}`) && !win32.isAbsolute(relative))
	);
}

function denials(output: string): SandboxDenial[] {
	const found = new Map<string, SandboxDenial>();
	for (const line of output.split(/\r?\n/u)) {
		const target = DENIED.test(line) ? lastPath(line) : null;
		if (target === null || found.has(target.toLowerCase())) continue;
		found.set(target.toLowerCase(), {
			tag: '',
			process: WROTE.exec(line)?.[1] ?? '',
			operation: 'file-write-create',
			target,
		});
	}
	return [...found.values()];
}

function lastPath(line: string): string | null {
	let found: string | null = null;
	for (const match of line.matchAll(PATHS)) {
		const path = windowsPath(match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '');
		if (path !== null) found = path;
	}
	return found;
}

function windowsPath(text: string): string | null {
	const trimmed = text.replace(/[:;,.]+$/u, '').replaceAll('\\\\', '\\');
	const msys = MSYS_DRIVE.exec(trimmed);
	const path = msys ? `${(msys[1] ?? '').toUpperCase()}:\\${msys[2] ?? ''}` : trimmed;
	return DRIVE_PATH.test(path) ? win32.normalize(path) : null;
}

export async function setUpWindowsSandbox(
	replace: boolean,
	progress: (done: number, total: number) => void,
): Promise<WindowsSetupOutcome> {
	const runtime = windowsRuntime();
	if (!runtime) return { outcome: 'failed', reason: 'the sandbox files are missing' };
	release(runtime);
	try {
		const result = await runtime.utils.installWindowsSandboxAsync({
			srtWin: runtime.srtWin,
			allowLoopback: true,
			force: replace,
			onProfileGrantProgress: (line) => {
				const [, done, total] = PROGRESS.exec(line) ?? [];
				if (done !== undefined && total !== undefined) progress(Number(done), Number(total));
			},
		});
		if (result.cancelled) return { outcome: 'cancelled' };
		if (result.profileGrant?.applied === false) {
			return { outcome: 'failed', reason: result.profileGrant.reason };
		}
		return { outcome: 'done' };
	} catch (error) {
		if (error instanceof runtime.utils.WindowsSandboxError) {
			if (error.code === 'install_config_conflict') return { outcome: 'conflict' };
			if (BUSY.has(error.code)) return { outcome: 'busy' };
		}
		return { outcome: 'failed', reason: firstLine(error) };
	}
}

export async function removeWindowsSandbox(): Promise<WindowsSetupOutcome> {
	const runtime = windowsRuntime();
	if (!runtime) return { outcome: 'failed', reason: 'the sandbox files are missing' };
	const { utils, srtWin } = runtime;
	release(runtime);
	const child = spawn(srtWin.exe, [...srtWin.prependArgs, 'uninstall'], {
		windowsHide: true,
		stdio: ['ignore', 'ignore', 'pipe'],
	});
	let errors = '';
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', (chunk: string) => {
		errors += chunk;
	});
	try {
		const [code]: unknown[] = await once(child, 'close');
		if (code === 0) return { outcome: 'done' };
		if (code === CANCELLED) return { outcome: 'cancelled' };
		if (code === utils.SRT_WIN_EXIT_HELD_BY_OTHERS || code === utils.SRT_WIN_EXIT_PROFILE_BUSY) {
			return { outcome: 'busy' };
		}
		return {
			outcome: 'failed',
			reason: firstLine(errors) || `srt-win stopped with ${String(code)}`,
		};
	} catch (error) {
		return { outcome: 'failed', reason: firstLine(error) };
	}
}

function settle(path: string, text: string): void {
	try {
		writeFileSync(`${path}.part`, text);
		renameSync(`${path}.part`, path);
	} catch {
		return;
	}
}

function firstLine(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).trim().split('\n')[0] ?? '';
}

function mixed(path: string): string {
	return path.replaceAll('\\', '/');
}

function isFolder(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}
