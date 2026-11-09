import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeCodeUpdates } from './claude-code-updates.service';

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fakeClaude(exitCode = 0): { readonly executable: string; calls(): string[] } {
	const root = mkdtempSync(join(tmpdir(), 'malini-claude-updates-'));
	roots.push(root);
	const executable = join(root, 'claude');
	const log = join(root, 'calls.log');
	writeFileSync(
		executable,
		`#!/bin/sh\nsleep 0.1\necho "$CLAUDE_UPDATE_MARK $*" >> "${log}"\nexit ${exitCode}\n`,
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

	it('keeps going when claude is missing or the update fails', async () => {
		const failing = fakeClaude(1);

		await expect(
			new ClaudeCodeUpdates({ executable: () => null, environment: () => ({}) }).check(),
		).resolves.toBeUndefined();
		await expect(
			new ClaudeCodeUpdates({
				executable: () => failing.executable,
				environment: () => ({}),
			}).check(),
		).resolves.toBeUndefined();
		await expect(
			new ClaudeCodeUpdates({
				executable: () => '/nowhere/claude',
				environment: () => ({}),
			}).check(),
		).resolves.toBeUndefined();
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

async function waitFor(done: () => boolean): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (!done()) {
		if (Date.now() > deadline) throw new Error('timed out');
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
