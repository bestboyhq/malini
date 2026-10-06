import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
	PERFORMANCE_BUDGETS,
	RuntimeDiagnostics,
} from '$shared/performance/runtime-diagnostics.svelte';

import {
	FOREGROUND_ACTIVITY,
	ForegroundActivityChannel,
	foregroundActivity,
} from './foreground-activity.svelte';

const SOURCE_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function sourceFiles(): readonly string[] {
	const found: string[] = [];
	const walk = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
				walk(path);
				continue;
			}
			if (/\.(ts|svelte)$/u.test(entry.name) && !/\.(test|spec)\.ts$/u.test(entry.name)) {
				found.push(path);
			}
		}
	};
	walk(SOURCE_ROOT);
	return found;
}

const CHANNEL_OWN_FILES = new Set([
	'lib/shared/shell/foreground-activity.svelte.ts',
	'lib/app/presentation/ForegroundActivityIndicator.svelte',
]);

describe('the foreground activity channel', () => {
	beforeEach(() => {
		foregroundActivity.reset();
	});

	it('stays silent while a background repository span is measured', async () => {
		const diagnostics = new RuntimeDiagnostics();
		const channel = new ForegroundActivityChannel();
		let announcedDuringSpan: string | null = 'not-read';

		await diagnostics.measure(
			{
				category: 'repository',
				label: 'Checking pull request',
				budgetMs: PERFORMANCE_BUDGETS.repositoryReadMs,
				target: 'workstream-one',
			},
			async () => {
				announcedDuringSpan = channel.current?.message ?? null;
			},
		);

		expect(announcedDuringSpan).toBeNull();
		expect(channel.current).toBeNull();
		expect(diagnostics.recent).toHaveLength(1);
	});

	it('announces work the user started, for exactly as long as it runs', async () => {
		const channel = new ForegroundActivityChannel();
		let announcedDuringOperation: string | null = null;

		await channel.track(FOREGROUND_ACTIVITY.startingAgent, async () => {
			announcedDuringOperation = channel.current?.message ?? null;
		});

		expect(announcedDuringOperation).toBe('Starting the agent');
		expect(channel.current).toBeNull();
	});

	it('clears the announcement when the operation fails', async () => {
		const channel = new ForegroundActivityChannel();

		await expect(
			channel.track(FOREGROUND_ACTIVITY.startingAgent, async () => {
				throw new Error('bridge refused the session');
			}),
		).rejects.toThrow('bridge refused the session');

		expect(channel.current).toBeNull();
	});

	it('falls back to the operation still running when a newer one ends first', () => {
		const channel = new ForegroundActivityChannel();
		const first = channel.begin(FOREGROUND_ACTIVITY.startingAgent);
		const second = channel.begin(FOREGROUND_ACTIVITY.startingAgent);

		expect(channel.current?.id).toBe(second.id);
		second.end();
		expect(channel.current?.id).toBe(first.id);
		first.end();
		expect(channel.current).toBeNull();
	});

	it('ignores a handle that is ended twice', () => {
		const channel = new ForegroundActivityChannel();
		const outer = channel.begin(FOREGROUND_ACTIVITY.startingAgent);
		const inner = channel.begin(FOREGROUND_ACTIVITY.startingAgent);

		inner.end();
		inner.end();
		expect(channel.current?.id).toBe(outer.id);
	});
});

describe('what the app is allowed to say out loud', () => {
	it('publishes only hand-written copy', () => {
		expect(FOREGROUND_ACTIVITY).toStrictEqual({ startingAgent: 'Starting the agent' });
	});

	it('is announced from exactly the call sites that are user-initiated waits', () => {
		const callers = sourceFiles()
			.filter((path) => !CHANNEL_OWN_FILES.has(relative(SOURCE_ROOT, path)))
			.filter((path) => /foregroundActivity\.(track|begin)\(/u.test(readFileSync(path, 'utf8')))
			.map((path) => relative(SOURCE_ROOT, path))
			.sort();

		expect(callers).toStrictEqual([
			'lib/chat/infrastructure/services/agent-runner.service.svelte.ts',
		]);
	});

	it('keeps the open diagnostics spans out of every component', () => {
		const readers = sourceFiles()
			.filter((path) => path.endsWith('.svelte'))
			.filter((path) => readFileSync(path, 'utf8').includes('runtimeDiagnostics.active'))
			.map((path) => relative(SOURCE_ROOT, path));

		expect(readers).toStrictEqual([]);
	});
});
