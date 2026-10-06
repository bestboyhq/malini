import { execFileSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';

const POLL_MS = 15_000;
const STOP_TIMEOUT_MS = 60_000;
const FIRST_RETRY_MS = 5_000;
const LAST_RETRY_MS = 5 * 60_000;
const RENDERER_PORT = '5798';
const appRoot = resolve(import.meta.dirname, '..');

const OUTSIDE_THE_WATCH = [
	/(^|\/)package\.json$/,
	/^pnpm-lock\.yaml$/,
	/^pnpm-workspace\.yaml$/,
	/^\.npmrc$/,
	/(^|\/)tsconfig[^/]*\.json$/,
	/^apps\/malini\/(electron\.vite\.config\.ts|svelte\.config\.mjs)$/,
	/^packages\/agent-bridge\/scripts\//,
];

/**
 * @param {readonly string[]} changedFiles
 * @returns {boolean}
 */
export function needsFreshDevServer(changedFiles) {
	return changedFiles.some((file) => OUTSIDE_THE_WATCH.some((pattern) => pattern.test(file)));
}

/** @param {string[]} args */
const git = (...args) =>
	execFileSync('git', args, {
		cwd: appRoot,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	}).trim();
/** @param {string} line */
const say = (line) => console.log(`dogfood: ${line}`);
/** @param {unknown} error */
const describe = (error) => (error instanceof Error ? error.message : String(error));
/** @param {number} ms */
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const commit = () => git('log', '-1', '--format=%h %s');

/** @param {number} group */
function electronMainPid(group) {
	try {
		const [pid] = execFileSync('pgrep', ['-g', String(group), '-f', 'MacOS/Electron \\.'], {
			encoding: 'utf8',
		}).split('\n');
		return Number(pid) || null;
	} catch {
		return null;
	}
}

/** @param {number} pid */
function groupAlive(pid) {
	try {
		process.kill(-pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && 'code' in error && error.code === 'EPERM';
	}
}

/** @type {import('node:child_process').ChildProcess | null} */
let app = null;
/** @type {NodeJS.Timeout | null} */
let retry = null;
let retryMs = FIRST_RETRY_MS;
let dependenciesStale = true;
let reportedDivergence = '';
let quitting = false;

function start() {
	if (quitting) return;
	if (retry) clearTimeout(retry);
	retry = null;
	if (dependenciesStale) {
		try {
			execFileSync('pnpm', ['install'], { cwd: appRoot, stdio: 'inherit' });
			dependenciesStale = false;
		} catch (error) {
			say(`pnpm install failed: ${describe(error)}`);
		}
	}
	const child = spawn('pnpm', ['dev'], {
		cwd: appRoot,
		env: { ...process.env, MALINI_RENDERER_PORT: RENDERER_PORT },
		stdio: 'inherit',
		detached: true,
	});
	const startedAt = Date.now();
	app = child;
	child.on('exit', (code) => {
		if (app !== child) return;
		app = null;
		if (code === 0) {
			say('malini quit, stopping');
			process.exit(0);
		}
		if (Date.now() - startedAt > LAST_RETRY_MS) retryMs = FIRST_RETRY_MS;
		say(`malini exited with code ${code}, starting it again in ${retryMs / 1000}s`);
		retry = setTimeout(start, retryMs);
		retryMs = Math.min(retryMs * 2, LAST_RETRY_MS);
	});
}

async function stop() {
	const child = app;
	app = null;
	if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
	const group = child.pid;
	const exited = new Promise((done) => child.once('exit', done));
	process.kill(electronMainPid(group) ?? -group, 'SIGTERM');
	await Promise.race([exited, sleep(STOP_TIMEOUT_MS)]);
	if (groupAlive(group)) process.kill(-group, 'SIGKILL');
}

function incoming() {
	try {
		git('fetch', '--quiet', 'origin', 'main');
	} catch {
		return null;
	}
	const target = git('rev-parse', 'origin/main');
	if (target === git('rev-parse', 'HEAD')) return null;
	try {
		git('merge-base', '--is-ancestor', 'HEAD', target);
	} catch {
		if (reportedDivergence !== target)
			say(`main has diverged from origin/main, staying on ${commit()}`);
		reportedDivergence = target;
		return null;
	}
	return { target, changed: git('diff', '--name-only', 'HEAD', target).split('\n') };
}

/** @param {string} target */
function advance(target) {
	try {
		git('merge', '--ff-only', '--quiet', target);
		say(`now on ${commit()}`);
		return true;
	} catch (error) {
		say(`could not update: ${describe(error)}`);
		return false;
	}
}

async function follow() {
	const update = incoming();
	if (!update) return;
	retryMs = FIRST_RETRY_MS;
	const fresh = needsFreshDevServer(update.changed);
	if (fresh) await stop();
	if (advance(update.target) && fresh) dependenciesStale = true;
	if (update.changed.includes('apps/malini/scripts/dogfood.mjs')) {
		say('this script changed, restart pnpm dogfood to run the new one');
	}
	if (!app) start();
}

async function quit() {
	quitting = true;
	if (retry) clearTimeout(retry);
	await stop();
	process.exit(0);
}

if (import.meta.main) {
	if (git('branch', '--show-current') !== 'main') {
		say('switch this checkout to main first, it follows origin/main');
		process.exit(1);
	}
	process.on('SIGINT', () => void quit());
	process.on('SIGTERM', () => void quit());
	const first = incoming();
	if (first) advance(first.target);
	say(`running ${commit()}`);
	start();
	while (!quitting) {
		await sleep(POLL_MS);
		if (!quitting) await follow();
	}
}
