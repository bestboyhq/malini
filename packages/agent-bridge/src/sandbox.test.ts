import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';
import { canSandbox, sandboxedCommand, sandboxProfile } from './sandbox.js';

const ROOT = mkdtempSync(join(tmpdir(), 'malini-sandbox-test-'));
const CHECKOUT = join(ROOT, 'checkout');
const IN_HOME = join(homedir(), `.malini-sandbox-test-${process.pid}`);

mkdirSync(CHECKOUT);
execFileSync('git', ['init', '--quiet'], { cwd: CHECKOUT });

afterAll(async () => {
	await rm(ROOT, { recursive: true, force: true });
	await rm(IN_HOME, { force: true });
});

function inside(command: string): Promise<number> {
	const [file, args] = sandboxedCommand(
		sandboxProfile({ checkout: CHECKOUT, hidden: [], internet: false }),
		'/bin/bash',
		['-c', command],
	);
	return new Promise((resolve) => {
		execFile(file, args, { cwd: CHECKOUT }, (error) =>
			resolve(typeof error?.code === 'number' ? error.code : 0),
		);
	});
}

describe.runIf(canSandbox())('sandboxProfile', () => {
	it('lets a command change the checkout and its git index', async () => {
		expect(await inside('echo hi > notes.txt && git add notes.txt && mkdir -p .cache/x')).toBe(0);
	});

	it.each([
		['the home folder', `touch ${IN_HOME}`],
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

	it('keeps a command off the internet when the internet is off', async () => {
		expect(await inside('/usr/bin/nc -z -G 2 1.1.1.1 443')).not.toBe(0);
	});
});
