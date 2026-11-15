import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	APP_ROOT,
	type LaunchOptions,
	prepareProfile,
	type ProcessEntry,
	processTable,
	processTree,
	stillRunning,
	stopProcess,
	waitWhile,
} from './harness';

const electronBinary = createRequire(__filename)('electron') as string;

interface RunnerLaunch {
	readonly runner: ChildProcess;
	readonly malini: number;
	tracked: ProcessEntry[];
}

let launched: RunnerLaunch | undefined;

test.afterEach(async () => {
	if (!launched) return;
	const { runner, malini, tracked } = launched;
	launched = undefined;
	runner.kill('SIGKILL');
	const table = await processTable();
	for (const entry of await stillRunning([...tracked, ...processTree(table, malini)], table)) {
		stopProcess(entry.pid);
	}
});

test('a killed test run leaves no process of the app behind', async () => {
	test.setTimeout(60_000);
	const { runner, malini } = await launchUnderRunner();
	const started = await remember(malini);

	runner.kill('SIGKILL');

	await expect
		.poll(async () => pidsOf(await stillRunning(started)), { timeout: 20_000 })
		.toEqual([]);
});

test('a killed test run stops an app that no longer answers', async () => {
	test.setTimeout(90_000);
	const { runner, malini } = await launchUnderRunner();
	const started = await remember(malini);

	const runnerGone = new Promise((resolve) => runner.once('exit', resolve));
	runner.kill('SIGKILL');
	await runnerGone;
	process.kill(malini, 'SIGSTOP');

	await expect
		.poll(async () => pidsOf(await stillRunning(started)), { timeout: 40_000 })
		.toEqual([]);
});

test('a crashed app ends the process groups it started', async () => {
	test.setTimeout(60_000);
	const groupMate = "trap '' TERM; while :; do /bin/sleep 1; done";
	const { malini } = await launchUnderRunner({ env: { FAKE_BRIDGE_GROUP_MATE: groupMate } });
	await expect
		.poll(async () =>
			processTree(await processTable(), malini).some(({ line }) => line.includes(groupMate)),
		)
		.toBe(true);
	const started = await remember(malini);

	process.kill(malini, 'SIGKILL');

	await expect
		.poll(async () => pidsOf(await stillRunning(started)), { timeout: 20_000 })
		.toEqual([]);
});

async function launchUnderRunner(options: LaunchOptions = {}): Promise<RunnerLaunch> {
	const profile = prepareProfile(options);
	const pidFile = join(profile.root, 'malini.pid');
	const runner = spawn(
		'/bin/sh',
		[
			'-c',
			`set -m; "$0" "$@" & echo $! > '${pidFile}.new' && mv '${pidFile}.new' '${pidFile}'; ${waitWhile('true', 1)}`,
			electronBinary,
			'--remote-debugging-port=0',
			...profile.args,
		],
		{ cwd: APP_ROOT, env: profile.env, detached: true },
	);
	let output = '';
	const keepOutput = (chunk: Buffer): void => {
		output += chunk.toString('utf8');
	};
	runner.stdout.on('data', keepOutput);
	runner.stderr.on('data', keepOutput);
	launched = { runner, malini: 0, tracked: [] };
	await expect.poll(() => existsSync(pidFile)).toBe(true);
	const malini = Number(readFileSync(pidFile, 'utf8'));
	launched = { runner, malini, tracked: processTree(await processTable(), malini) };
	await expect
		.poll(() => windowTitles(output), { timeout: 30_000 })
		.toContain('Malini · Repositories');
	return launched;
}

async function remember(malini: number): Promise<ProcessEntry[]> {
	const started = processTree(await processTable(), malini);
	expect(pidsOf(started), 'the app and the processes it started').toContain(malini);
	expect(started.length, 'the app and the processes it started').toBeGreaterThan(1);
	if (launched) launched.tracked = started;
	return started;
}

async function windowTitles(output: string): Promise<string[]> {
	const host = /DevTools listening on ws:\/\/([^/\s]+)\//u.exec(output)?.[1];
	if (!host) return [];
	try {
		const targets = (await (await fetch(`http://${host}/json/list`)).json()) as { title: string }[];
		return targets.map((target) => target.title);
	} catch {
		return [];
	}
}

function pidsOf(entries: readonly ProcessEntry[]): number[] {
	return entries.map((entry) => entry.pid);
}
