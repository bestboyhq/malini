import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import type { SandboxDenial, SandboxEngine, SandboxProblem, SandboxRules } from '../sandbox.js';

const BWRAP = 'bwrap';
const NEEDS_MAJOR = 0;
const NEEDS_MINOR = 8;
const VERSION = /(\d+)\.(\d+)/u;
const BASE = [
	'--new-session',
	'--die-with-parent',
	'--unshare-pid',
	'--unshare-user',
	'--disable-userns',
	'--cap-drop',
	'ALL',
	'--ro-bind',
	'/',
	'/',
	'--dev',
	'/dev',
	'--proc',
	'/proc',
];
const CONTAINERS = ['/.dockerenv', '/run/.containerenv'];
const DISPLAY_FOLDERS = ['/tmp/.X11-unix', '/tmp/.ICE-unix'];
const SERVICE_SOCKETS = [
	'/run/docker.sock',
	'/var/run/docker.sock',
	'/run/podman/podman.sock',
	'/run/dbus/system_bus_socket',
	'/var/run/dbus/system_bus_socket',
];
const EROFS = /read-only file system|\bEROFS\b/iu;
const QUOTED = /'([^']+)'|"([^"]+)"|‘([^’]+)’|(\/\S+)/gu;
const WROTE = /^([a-z][\w.+-]*):/u;

export const bubblewrap: SandboxEngine = { problem, prefix, denials };

function problem(): SandboxProblem | null {
	const version = spawnSync(BWRAP, ['--version'], { encoding: 'utf8' });
	if (version.status !== 0) return 'missing';
	const [, major = '', minor = ''] = VERSION.exec(version.stdout) ?? [];
	if (
		Number(major) < NEEDS_MAJOR ||
		(Number(major) === NEEDS_MAJOR && Number(minor) < NEEDS_MINOR)
	) {
		return 'outdated';
	}
	if (spawnSync(BWRAP, [...BASE, '--', '/bin/true']).status === 0) return null;
	return CONTAINERS.some((marker) => existsSync(marker)) ? 'nested' : 'blocked';
}

function prefix(rules: SandboxRules): string[] {
	const runtime = process.env['XDG_RUNTIME_DIR'];
	return [
		BWRAP,
		...BASE,
		...(rules.internet ? [] : ['--unshare-net']),
		...rules.write.flatMap((path) => ['--bind-try', path, path]),
		...rules.readOnly.flatMap((path) => ['--ro-bind-try', path, path]),
		...[...rules.closed, ...DISPLAY_FOLDERS].flatMap(hide),
		...SERVICE_SOCKETS.flatMap(cover),
		...(runtime && existsSync(runtime) ? ['--tmpfs', runtime] : []),
		...rules.sockets.flatMap((path) => ['--bind-try', path, path]),
		'--',
	];
}

function hide(path: string): string[] {
	if (!existsSync(path)) return [];
	return isFolder(path) ? ['--tmpfs', path, '--remount-ro', path] : cover(path);
}

function cover(path: string): string[] {
	return existsSync(path) ? ['--ro-bind', '/dev/null', path] : [];
}

function denials(output: string): SandboxDenial[] {
	const found = new Map<string, SandboxDenial>();
	for (const line of output.split('\n')) {
		const target = EROFS.test(line) ? lastPath(line) : null;
		if (target === null || found.has(target)) continue;
		found.set(target, {
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
	for (const match of line.matchAll(QUOTED)) {
		const path = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? '').replace(/[:;,.]+$/u, '');
		if (path.startsWith('/')) found = path;
	}
	return found;
}

function isFolder(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}
