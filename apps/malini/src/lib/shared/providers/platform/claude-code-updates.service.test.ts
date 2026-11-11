import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { blockedUpdate, ClaudeCodeUpdates } from './claude-code-updates.service';

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
		expect(await updates.checkIfStale()).toBe(true);
		expect(await updates.checkIfStale()).toBe(false);
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
			recheckAfterMs: 400,
		});

		await Promise.all([updates.check(), updates.checkIfStale()]);
		expect(claude.calls()).toEqual(['mark update']);
		expect(await updates.checkIfStale()).toBe(false);
		expect(claude.calls()).toEqual(['mark update']);

		await new Promise((resolve) => setTimeout(resolve, 400));
		await updates.checkIfStale();
		expect(claude.calls()).toEqual(['mark update', 'mark update']);
	});

	it('reports an update that something else made, such as brew upgrade, at the next ask', async () => {
		const claude = fakeClaude();
		const updates = new ClaudeCodeUpdates({
			executable: () => claude.executable,
			environment: () => ({ CLAUDE_UPDATE_MARK: 'mark' }),
		});

		expect(await updates.check()).toBe(false);
		expect(await updates.checkIfStale()).toBe(false);
		writeFileSync(claude.executable, `${readFileSync(claude.executable, 'utf8')}# 2.0.0\n`);

		expect(await updates.checkIfStale()).toBe(true);
		expect(claude.calls()).toEqual(['mark update', 'mark update']);
	});

	it('keeps what blocks the last update, and forgets it once an update goes through', async () => {
		const outputs = mkdtempSync(join(tmpdir(), 'malini-claude-update-output-'));
		roots.push(outputs);
		writeFileSync(join(outputs, 'brew'), HOMEBREW_UPDATE_AVAILABLE);
		const claude = fakeClaude(0, `cat "${join(outputs, 'brew')}"`);
		const updates = new ClaudeCodeUpdates({
			executable: () => claude.executable,
			environment: () => ({}),
		});

		await updates.check();
		expect(updates.blocked).toEqual({
			managedBy: 'Homebrew',
			version: '2.1.311',
			command: 'brew upgrade claude-code',
		});

		writeFileSync(join(outputs, 'brew'), 'Claude is managed by Homebrew.\nClaude is up to date!\n');
		await updates.check();
		expect(updates.blocked).toBeNull();
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
			managedBy: 'Homebrew',
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
			managedBy: 'winget',
			version: '2.1.311',
			command: 'winget upgrade Anthropic.ClaudeCode',
		});
	});

	it('sends a read-only npm install to the native installer', () => {
		expect(blockedUpdate(ran(NPM_READ_ONLY_STDOUT, NPM_READ_ONLY_STDERR, 1))).toEqual({
			managedBy: 'npm',
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
