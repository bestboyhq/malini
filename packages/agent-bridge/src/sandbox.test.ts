import { execFile, execFileSync } from 'node:child_process';
import { globSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';
import {
	canSandbox,
	grantProblem,
	sandboxDenial,
	sandboxedCommand,
	sandboxGrant,
	sandboxProfile,
	type SandboxDenial,
	type SandboxPlaces,
} from './sandbox.js';
import { SandboxDenials } from './sandbox-denials.js';

const ROOT = mkdtempSync(join(tmpdir(), 'malini-sandbox-test-'));
const CHECKOUT = join(ROOT, 'checkout');
const IN_HOME = join(homedir(), `.malini-sandbox-test-${process.pid}`);
const PNPM_HOME = join(homedir(), 'Library/pnpm');
const IN_PNPM_HOME = join(PNPM_HOME, `malini-sandbox-test-${process.pid}`);
const GRANTED = join(homedir(), `.malini-sandbox-test-${process.pid}-granted`);
const SOCKET = join(homedir(), `.malini-sandbox-test-${process.pid}.sock`);
const PLAYWRIGHT_BROWSERS = join(homedir(), 'Library/Caches/ms-playwright');
const HEADLESS_CHROMIUM = globSync('chromium_headless_shell-*/*/chrome-headless-shell', {
	cwd: PLAYWRIGHT_BROWSERS,
})
	.map((path) => join(PLAYWRIGHT_BROWSERS, path))
	.at(-1);

mkdirSync(CHECKOUT);
execFileSync('git', ['init', '--quiet'], { cwd: CHECKOUT });

afterAll(async () => {
	await rm(ROOT, { recursive: true, force: true });
	await rm(IN_HOME, { force: true });
	await rm(IN_PNPM_HOME, { force: true });
	await rm(GRANTED, { recursive: true, force: true });
});

function inside(command: string, places: Partial<SandboxPlaces> = {}): Promise<number> {
	const [file, args] = sandboxedCommand(
		sandboxProfile({ checkout: CHECKOUT, hidden: [], internet: false, ...places }),
		'/bin/bash',
		['-c', command],
	);
	return new Promise((resolve) => {
		execFile(file, args, { cwd: CHECKOUT }, (error) =>
			resolve(typeof error?.code === 'number' ? error.code : error ? 1 : 0),
		);
	});
}

describe.runIf(canSandbox())('sandboxProfile', () => {
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
		const module = pathToFileURL(join(import.meta.dirname, 'sandbox.ts')).href;
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
		const blocked = new Promise<void>((resolve) => {
			const unwatch = denials.watch(tag, (denial) => {
				seen.push(denial);
				unwatch();
				resolve();
			});
		});
		const release = await denials.hold();
		onTestFinished(release);

		await inside(`touch ${IN_HOME}`, { tag });
		await blocked;

		expect(seen[0]).toMatchObject({ tag, operation: 'file-write-create', target: IN_HOME });
	}, 10_000);

	it('lets a command read the system log, which refuses to run in a sandbox', async () => {
		expect(await inside('/usr/bin/log show --last 1s --style compact')).toBe(0);
	});

	it('keeps a command off the internet when the internet is off', async () => {
		expect(await inside('/usr/bin/nc -z -G 2 1.1.1.1 443')).not.toBe(0);
	});
});

describe('sandbox grants', () => {
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
	])('offers the folder a tool keeps for %s', (target, path) => {
		expect(sandboxGrant(denial('file-write-create', target), places, home)).toEqual({
			kind: 'path',
			path,
		});
	});

	it('offers the exact socket a command could not reach', () => {
		const socket = `${home}/.docker/run/docker.sock`;

		expect(sandboxGrant(denial('network-outbound', socket), places, home)).toEqual({
			kind: 'socket',
			path: socket,
		});
	});

	it.each([
		['a key agent', denial('network-outbound', `${home}/.ssh/agent.sock`)],
		['a hidden place', denial('file-write-create', `${home}/.private/notes`)],
		['credentials', denial('file-write-create', `${home}/.aws/credentials`)],
		['a shell startup file', denial('file-write-create', `${home}/.zshrc`)],
		['a folder every app shares', denial('file-write-create', `${home}/notes.txt`)],
		[
			'a folder that holds the checkout',
			denial('file-write-create', `${home}/malini/workstreams/b/x`),
		],
		['a macOS service', denial('mach-lookup', 'com.apple.pasteboard.1')],
	])('offers nothing for %s', (_place, blocked) => {
		expect(sandboxGrant(blocked, places, home)).toBeNull();
	});

	it("refuses a grant into Malini's own data", () => {
		const appData = `${home}/Library/Application Support/malini`;
		process.env['MALINI_APP_DATA_ROOT'] = appData;
		onTestFinished(() => {
			delete process.env['MALINI_APP_DATA_ROOT'];
		});

		expect(grantProblem({ kind: 'path', path: appData }, places, home)).toBe(
			"holds Malini's own data",
		);
		expect(grantProblem({ kind: 'path', path: `${home}/.cache/x/../y` }, places, home)).toBe(
			'is not an absolute, normalized path',
		);
	});
});
