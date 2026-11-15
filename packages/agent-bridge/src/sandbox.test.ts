import { execFile, execFileSync, spawn } from 'node:child_process';
import { globSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import {
	canSandbox,
	grantProblem,
	sandboxDenial,
	sandboxDenialsIn,
	sandboxedCommand,
	sandboxGrant,
	toolStateGrant,
	type SandboxDenial,
	type SandboxPlaces,
} from './sandbox.js';
import { SandboxDenials } from './sandbox-denials.js';

const DARWIN = process.platform === 'darwin';
const LINUX = process.platform === 'linux';
const ROOT = mkdtempSync(join(tmpdir(), 'malini-sandbox-test-'));
const CHECKOUT = join(ROOT, 'checkout');
const IN_HOME = join(homedir(), `.malini-sandbox-test-${process.pid}`);
const PNPM_HOME = join(homedir(), 'Library/pnpm');
const IN_PNPM_HOME = join(PNPM_HOME, `malini-sandbox-test-${process.pid}`);
const GRANTED = join(homedir(), `.malini-sandbox-test-${process.pid}-granted`);
const FAKE_HOME = join(homedir(), `.malini-sandbox-test-home-${process.pid}`);
const SOCKET = join(homedir(), `.malini-sandbox-test-${process.pid}.sock`);
const PLAYWRIGHT_BROWSERS = join(homedir(), 'Library/Caches/ms-playwright');
const HEADLESS_CHROMIUM = globSync('chromium_headless_shell-*/*/chrome-headless-shell', {
	cwd: PLAYWRIGHT_BROWSERS,
})
	.map((path) => join(PLAYWRIGHT_BROWSERS, path))
	.at(-1);

mkdirSync(CHECKOUT);
if (canSandbox() && DARWIN) {
	mkdirSync(join(FAKE_HOME, 'Documents'), { recursive: true });
	mkdirSync(join(FAKE_HOME, 'Library/LaunchAgents'), { recursive: true });
	mkdirSync(join(FAKE_HOME, '.ssh'), { recursive: true });
	writeFileSync(join(FAKE_HOME, 'Documents/private.txt'), 'private');
	writeFileSync(join(FAKE_HOME, '.ssh/id_ed25519'), 'key');
}
execFileSync('git', ['init', '--quiet'], { cwd: CHECKOUT });

afterAll(async () => {
	await rm(ROOT, { recursive: true, force: true });
	await rm(IN_HOME, { force: true });
	await rm(IN_PNPM_HOME, { force: true });
	await rm(GRANTED, { recursive: true, force: true });
	await rm(FAKE_HOME, { recursive: true, force: true });
});

function inside(command: string, places: Partial<SandboxPlaces> = {}): Promise<number> {
	return runInside(command, homedir(), places);
}

function runInside(
	command: string,
	home: string,
	places: Partial<SandboxPlaces> = {},
): Promise<number> {
	const [file, args] = sandboxedCommand(
		{ checkout: CHECKOUT, hidden: [], internet: false, ...places },
		'/bin/bash',
		['-c', command],
		home,
	);
	return new Promise((resolve) => {
		execFile(file, args, { cwd: CHECKOUT }, (error) =>
			resolve(typeof error?.code === 'number' ? error.code : error ? 1 : 0),
		);
	});
}

describe.runIf(canSandbox() && DARWIN)('sandboxProfile', () => {
	it('lets a command change the checkout and its git index', async () => {
		expect(await inside('echo hi > notes.txt && git add notes.txt && mkdir -p .cache/x')).toBe(0);
	});

	it('lets pnpm link into its home, so it keeps its store there instead of in the checkout', async () => {
		const probe = join(PNPM_HOME, `_tmp_${process.pid}_sandbox`);

		expect(
			await inside(
				`touch linked && mkdir '${probe}' && ln linked '${probe}/linked' && rm -r '${probe}'`,
			),
		).toBe(0);
	});

	it.each([
		['the home folder', `touch ${IN_HOME}`],
		['the pnpm home', `touch '${IN_PNPM_HOME}'`],
		['a git hook', 'touch .git/hooks/pre-commit'],
		['the git config', 'git config core.hooksPath /tmp'],
		['the git common dir', 'printf x > .git/commondir'],
		["Claude Code's settings", 'mkdir -p .claude && touch .claude/settings.json'],
		['the MCP servers', 'touch .mcp.json'],
	])('keeps a command from writing %s', async (_place, command) => {
		expect(await inside(command)).not.toBe(0);
	});

	it("hides every bridge's secrets folder", async () => {
		const bridgeSecrets = mkdtempSync(join(tmpdir(), `malini-secrets-${process.pid}-`));
		onTestFinished(() => rm(bridgeSecrets, { recursive: true, force: true }));
		writeFileSync(join(bridgeSecrets, 'secrets.sh'), 'TOKEN=1');

		expect(await inside(`cat ${join(bridgeSecrets, 'secrets.sh')}`)).not.toBe(0);
		expect(await inside(`touch ${join(bridgeSecrets, 'pass')}`)).not.toBe(0);
	});

	it('lets a Malini a command starts keep its own secrets folder', async () => {
		const profileTemp = join(ROOT, 'malini-profile-test', 'tmp');

		expect(
			await inside(`mkdir -p ${profileTemp} && mktemp -d ${profileTemp}/malini-secrets-1-XXXXXX`),
		).toBe(0);
	});

	it('leaves a process that already runs in a sandbox to that sandbox', async () => {
		const module = pathToFileURL(join(import.meta.dirname, '..', 'dist', 'sandbox.js')).href;
		const probe = `node --input-type=module -e "import { canSandbox } from '${module}'; process.exit(canSandbox() ? 3 : 4)"`;

		expect(await inside(probe)).toBe(4);
	});

	it.runIf(HEADLESS_CHROMIUM)("lets Playwright's Chromium start", async () => {
		expect(await inside(`'${HEADLESS_CHROMIUM}' --no-sandbox --dump-dom 'data:text/html,ok'`)).toBe(
			0,
		);
	});

	it('lets a command write to a folder the user allowed, but not its git hooks', async () => {
		const grants = [{ kind: 'path', path: GRANTED }] as const;
		mkdirSync(join(GRANTED, 'repo/.git/hooks'), { recursive: true });

		expect(await inside(`touch ${GRANTED}/state`)).not.toBe(0);
		expect(await inside(`touch ${GRANTED}/state`, { grants })).toBe(0);
		expect(await inside(`touch ${GRANTED}/repo/.git/hooks/pre-commit`, { grants })).not.toBe(0);
	});

	it('keeps user data and keys closed to reads and writes', async () => {
		expect(
			await runInside(`cat '${join(FAKE_HOME, 'Documents/private.txt')}'`, FAKE_HOME),
		).not.toBe(0);
		expect(await runInside(`touch '${join(FAKE_HOME, 'Documents/new.txt')}'`, FAKE_HOME)).not.toBe(
			0,
		);
		expect(await runInside(`cat '${join(FAKE_HOME, '.ssh/id_ed25519')}'`, FAKE_HOME)).not.toBe(0);
	});

	it('stops a planted package that reads a key, reads a document, or writes a way to run later', async () => {
		const attempts = [
			`cat '${join(FAKE_HOME, '.ssh/id_ed25519')}'`,
			`cat '${join(FAKE_HOME, 'Documents/private.txt')}'`,
			`touch '${join(FAKE_HOME, 'Library/LaunchAgents/planted.plist')}'`,
			`touch '${join(FAKE_HOME, '.zshrc')}'`,
		];

		for (const attempt of attempts) expect(await runInside(attempt, FAKE_HOME)).not.toBe(0);
	});

	it('opens a tool-state folder only when the grant names it', async () => {
		const logs = join(FAKE_HOME, 'Library/Logs/node');
		mkdirSync(logs, { recursive: true });

		expect(await runInside(`touch '${logs}/today.log'`, FAKE_HOME)).not.toBe(0);
		expect(
			await runInside(`touch '${logs}/today.log'`, FAKE_HOME, {
				grants: [{ kind: 'path', path: logs }],
			}),
		).toBe(0);
	});

	it('lets a command reach a socket the user allowed', async () => {
		const server = createServer((connection) => connection.end());
		await new Promise<void>((resolve) => server.listen(SOCKET, resolve));
		onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
		const reach = `/usr/bin/nc -U ${SOCKET} < /dev/null`;

		expect(await inside(reach)).not.toBe(0);
		expect(await inside(reach, { grants: [{ kind: 'socket', path: SOCKET }] })).toBe(0);
	});

	it('reports what it blocked under the tag of its session', async () => {
		const tag = `malini-sandbox-test${process.pid}`;
		const denials = new SandboxDenials();
		const seen: SandboxDenial[] = [];
		onTestFinished(denials.watch(tag, (denial) => seen.push(denial)));
		onTestFinished(await denials.hold());

		while (seen.length === 0) await inside(`touch ${IN_HOME}`, { tag });

		expect(seen[0]).toMatchObject({ tag, operation: 'file-write-create', target: IN_HOME });
	}, 10_000);

	it('lets a command read the system log, which refuses to run in a sandbox', async () => {
		expect(await inside('/usr/bin/log show --last 1s --style compact')).toBe(0);
	});

	it('lets a command write to the system log through its socket', async () => {
		expect(
			await inside(
				`/usr/bin/python3 -c "import socket; s = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM); s.connect('/private/var/run/syslog'); s.send(b'<13>malini sandbox test')"`,
			),
		).toBe(0);
	}, 30_000);

	it('keeps a command off the internet when the internet is off', async () => {
		expect(await inside('/usr/bin/nc -z -G 2 1.1.1.1 443')).not.toBe(0);
	});
});

describe.runIf(canSandbox() && LINUX)('bubblewrap', () => {
	const LINUX_HOME = join(homedir(), `.malini-sandbox-test-linux-${process.pid}`);
	const CLOSED = join(LINUX_HOME, '.ssh');
	const DOCUMENT = join(LINUX_HOME, 'Documents/private.txt');
	const run = (command: string, places: Partial<SandboxPlaces> = {}) =>
		runInside(command, LINUX_HOME, places);

	afterAll(() => rm(LINUX_HOME, { recursive: true, force: true }));

	beforeAll(() => {
		mkdirSync(join(LINUX_HOME, 'Documents'), { recursive: true });
		mkdirSync(CLOSED, { recursive: true });
		writeFileSync(DOCUMENT, 'private');
		writeFileSync(join(CLOSED, 'id_ed25519'), 'key');
		writeFileSync(join(CHECKOUT, '.git/commondir'), '.\n');
	});

	it('lets a command read the computer and change the checkout and its git index', async () => {
		expect(
			await run('cat /etc/hostname > notes.txt && git add notes.txt && mkdir -p .cache/x'),
		).toBe(0);
	});

	it.each([
		['the home folder', `touch ${join(LINUX_HOME, 'planted')}`],
		['another folder', 'touch /usr/local/planted'],
		['a git hook', 'touch .git/hooks/pre-commit'],
		['the git config', 'git config core.hooksPath /tmp'],
		['the git common dir', 'printf x > .git/commondir'],
	])('keeps a command from writing %s', async (_place, command) => {
		expect(await run(command)).not.toBe(0);
	});

	it('keeps user data and keys closed to reads and writes', async () => {
		expect(await run(`cat '${DOCUMENT}'`)).not.toBe(0);
		expect(await run(`cat '${join(CLOSED, 'id_ed25519')}'`)).not.toBe(0);
		expect(await run(`touch '${join(CLOSED, 'planted')}'`)).not.toBe(0);
	});

	it("hides every bridge's secrets folder", async () => {
		const bridgeSecrets = mkdtempSync(join(tmpdir(), `malini-secrets-${process.pid}-`));
		onTestFinished(() => rm(bridgeSecrets, { recursive: true, force: true }));
		writeFileSync(join(bridgeSecrets, 'secrets.sh'), 'TOKEN=1');

		expect(await run(`cat ${join(bridgeSecrets, 'secrets.sh')}`)).not.toBe(0);
	});

	it('lets a command write to a folder the user allowed, but not its git hooks', async () => {
		const granted = join(LINUX_HOME, '.granted-state');
		const grants = [{ kind: 'path', path: granted }] as const;
		mkdirSync(join(granted, '.git/hooks'), { recursive: true });

		expect(await run(`touch ${granted}/state`)).not.toBe(0);
		expect(await run(`touch ${granted}/state`, { grants })).toBe(0);
		expect(await run(`touch ${granted}/.git/hooks/pre-commit`, { grants })).not.toBe(0);
	});

	it('reaches only the processes of its own sandbox', async () => {
		const outside = spawn('/bin/sleep', ['30']);
		onTestFinished(() => void outside.kill('SIGKILL'));

		expect(await run(`kill ${outside.pid}`)).not.toBe(0);
		expect(outside.killed).toBe(false);
	});

	it('keeps no key agent, session bus, display server or docker socket', async () => {
		expect(await run('test -S "${SSH_AUTH_SOCK:-/run/docker.sock}"')).not.toBe(0);
		expect(await run('test -S "${DBUS_SESSION_BUS_ADDRESS#unix:path=}"')).not.toBe(0);
		expect(await run('test -S /run/docker.sock -o -S /var/run/docker.sock')).not.toBe(0);
		expect(await run('test -n "$(ls -A /tmp/.X11-unix)"')).not.toBe(0);
	});

	it('keeps localhost open with the internet on and closes everything with it off', async () => {
		const server = createServer((socket) => socket.end('ok'));
		onTestFinished(() => void server.close());
		await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
		const address = server.address();
		const port = address !== null && typeof address === 'object' ? address.port : 0;
		const reach = `/bin/bash -c 'exec 3<>/dev/tcp/127.0.0.1/${port}'`;

		expect(await run(reach, { internet: true })).toBe(0);
		expect(await run(reach)).not.toBe(0);
	});

	it('reads a denied write out of what a command printed', () => {
		expect(
			sandboxDenialsIn(
				[
					"touch: cannot touch '/home/someone/planted': Read-only file system",
					'mkdir: cannot create directory \u2018/home/someone/also\u2019: Read-only file system',
					"Error: EROFS: read-only file system, open '/home/someone/third'",
					'bash: line 1: /home/someone/planted: Read-only file system',
					'touch: cannot touch /home/someone/fine: No space left on device',
				].join('\n'),
			),
		).toEqual([
			{
				tag: '',
				process: 'touch',
				operation: 'file-write-create',
				target: '/home/someone/planted',
			},
			{ tag: '', process: 'mkdir', operation: 'file-write-create', target: '/home/someone/also' },
			{ tag: '', process: '', operation: 'file-write-create', target: '/home/someone/third' },
		]);
	});
});

describe.skipIf(process.platform === 'win32')('sandbox grants', () => {
	const home = '/Users/someone';
	const places = { checkout: `${home}/malini/workstreams/a`, hidden: [`${home}/.private`] };
	const denial = (operation: string, target: string): SandboxDenial => ({
		tag: 'malini-sandbox-1',
		process: 'node',
		operation,
		target,
	});

	it('reads a denial and its tag from the kernel log', () => {
		expect(
			sandboxDenial(
				'Sandbox: docker(4242) deny(1) network-outbound /Users/someone/.docker/run/docker.sock\nmalini-sandbox-1',
			),
		).toEqual({
			tag: 'malini-sandbox-1',
			process: 'docker',
			operation: 'network-outbound',
			target: '/Users/someone/.docker/run/docker.sock',
		});
		expect(
			sandboxDenial(
				'3 duplicate reports for Sandbox: node(1) deny(1) mach-lookup com.x\nmalini-sandbox-1',
			),
		).toMatchObject({ operation: 'mach-lookup', target: 'com.x' });
		expect(
			sandboxDenial('Sandbox: node(1) deny(1) file-write-create /tmp/x\nsomeone-else'),
		).toBeNull();
	});

	it.each([
		[`${home}/.agent-browser/sessions/a/socket`, `${home}/.agent-browser`],
		[
			`${home}/Library/Application Support/Some App/state.json`,
			`${home}/Library/Application Support/Some App`,
		],
		[`${home}/.config/wrangler/logs/today.log`, `${home}/.config/wrangler`],
		['/opt/homebrew/var/postgresql/pid', '/opt/homebrew/var'],
		[
			`${home}/Library/Application Support/Google/Chrome for Testing/Crashpad/settings.dat`,
			`${home}/Library/Application Support/Google/Chrome for Testing`,
		],
	])('offers the folder a tool keeps for %s', (target, path) => {
		expect(sandboxGrant(denial('file-write-create', target), places, home, 'darwin')).toEqual({
			kind: 'path',
			path,
		});
	});

	it('offers the exact socket a command could not reach', () => {
		const socket = `${home}/.docker/run/docker.sock`;

		expect(sandboxGrant(denial('network-outbound', socket), places, home, 'darwin')).toEqual({
			kind: 'socket',
			path: socket,
		});
	});

	it.each([
		['a key agent', denial('network-outbound', `${home}/.ssh/agent.sock`)],
		['a hidden place', denial('file-write-create', `${home}/.private/notes`)],
		['credentials', denial('file-write-create', `${home}/.aws/credentials`)],
		[
			"Chrome's profile",
			denial(
				'file-write-create',
				`${home}/Library/Application Support/Google/Chrome/Crashpad/settings.dat`,
			),
		],
		['a shell startup file', denial('file-write-create', `${home}/.zshrc`)],
		['a folder every app shares', denial('file-write-create', `${home}/notes.txt`)],
		[
			'a folder that holds the checkout',
			denial('file-write-create', `${home}/malini/workstreams/b/x`),
		],
		['a macOS service', denial('mach-lookup', 'com.apple.pasteboard.1')],
	])('offers nothing for %s', (_place, blocked) => {
		expect(sandboxGrant(blocked, places, home, 'darwin')).toBeNull();
	});

	it.each([
		[`${home}/Library/Logs/node/today.log`, 'node', `${home}/Library/Logs/node`],
		[`${home}/.local/state/claude/session.json`, 'claude', `${home}/.local/state/claude`],
		[`${home}/.npm/_logs/2026.log`, 'npm', `${home}/.npm`],
		[`${home}/.rtk/history.db`, 'rtk', `${home}/.rtk`],
		[
			`${home}/Library/Caches/ms-playwright/chromium`,
			'node',
			`${home}/Library/Caches/ms-playwright`,
		],
		[
			`${home}/Library/Application Support/rtk/history.db`,
			'rtk',
			`${home}/Library/Application Support/rtk`,
		],
		['/private/tmp/some-tool/state', 'node', '/private/tmp'],
	])('opens tool state at %s without asking', (target, process, path) => {
		expect(
			toolStateGrant({ ...denial('file-write-create', target), process }, places, home, 'darwin'),
		).toEqual({ kind: 'path', path });
	});

	it.each([
		['a socket', { ...denial('network-outbound', `${home}/.docker/run/docker.sock`) }],
		[
			'a folder named after another program',
			{ ...denial('file-write-create', `${home}/Library/Application Support/Slack/state`) },
		],
		['a file outside tool state', { ...denial('file-write-create', `${home}/notes.txt`) }],
		['your documents', { ...denial('file-write-create', `${home}/Documents/notes.txt`) }],
		['credentials', { ...denial('file-write-create', `${home}/.ssh/id_ed25519`), process: 'ssh' }],
		[
			'a launch agent',
			{ ...denial('file-write-create', `${home}/Library/LaunchAgents/x.plist`), process: 'x' },
		],
	])('opens nothing automatic for %s', (_place, blocked) => {
		expect(toolStateGrant(blocked, places, home, 'darwin')).toBeNull();
	});

	it('refuses a grant into user data', () => {
		expect(
			grantProblem(
				{ kind: 'path', path: `${home}/Library/Application Support/AddressBook` },
				places,
				home,
				'darwin',
			),
		).toBe('holds your files');
		expect(
			grantProblem({ kind: 'path', path: `${home}/Documents` }, places, home, 'darwin'),
		).not.toBeNull();
	});

	it('refuses a grant of a folder that holds credentials', () => {
		expect(
			grantProblem(
				{ kind: 'path', path: `${home}/Library/Application Support/Google` },
				places,
				home,
				'darwin',
			),
		).toBe('holds credentials');
	});

	it("refuses a grant into Malini's own data", () => {
		const appData = `${home}/Library/Application Support/malini`;
		process.env['MALINI_APP_DATA_ROOT'] = appData;
		onTestFinished(() => {
			delete process.env['MALINI_APP_DATA_ROOT'];
		});

		expect(grantProblem({ kind: 'path', path: appData }, places, home, 'darwin')).toBe(
			"holds Malini's own data",
		);
		expect(
			grantProblem({ kind: 'path', path: `${home}/.cache/x/../y` }, places, home, 'darwin'),
		).toBe('is not an absolute, normalized path');
	});
});

describe.runIf(process.platform === 'win32')('sandbox grants on Windows', () => {
	const home = 'C:\\Users\\someone';
	const places = {
		checkout: `${home}\\malini\\workstreams\\a`,
		hidden: [`${home}\\.private`],
	};
	const denial = (target: string, process = 'node'): SandboxDenial => ({
		tag: 'malini-sandbox-1',
		process,
		operation: 'file-write-create',
		target,
	});

	it('offers the top folder under a drive root', () => {
		expect(sandboxGrant(denial('D:\\work\\project\\out.txt'), places, home, 'win32')).toEqual({
			kind: 'path',
			path: 'D:\\work',
		});
	});

	it('offers the folder a tool keeps under AppData', () => {
		expect(
			toolStateGrant(
				denial(`${home}\\AppData\\Roaming\\wrangler\\logs\\today.log`, 'wrangler'),
				places,
				home,
				'win32',
			),
		).toEqual({ kind: 'path', path: `${home}\\AppData\\Roaming\\wrangler` });
	});

	it.each([
		['a drive root', 'C:\\'],
		['a folder every app shares', 'C:\\Windows'],
		['AppData itself', `${home}\\AppData\\Roaming`],
		['your files', `${home}\\Downloads`],
		['a folder that holds credentials', `${home}\\AppData\\Local\\Google`],
		['a shell startup file', `${home}\\.bashrc`],
		['the checkout', `${home}\\malini\\workstreams\\a\\src`],
	])('offers nothing for %s', (_place, path) => {
		expect(grantProblem({ kind: 'path', path }, places, home, 'win32')).not.toBeNull();
	});

	it("keeps Malini's secrets folder out of a grant", () => {
		expect(
			grantProblem(
				{ kind: 'path', path: `${home}\\AppData\\Local\\Temp\\malini-secrets-1-abc` },
				places,
				home,
				'win32',
			),
		).toBe("holds Malini's secrets");
	});
});
