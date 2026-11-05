import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, test } from '@playwright/test';
import {
	currentLogPath,
	diagnosticsDirectory,
	FRAMES_LOG_STEM,
} from '../../src/main/diagnostics/diagnostics-files';
import { expectCleanConsole, launchMalini } from './harness';

type Entry = Record<string, unknown>;

function journaled(userDataDir: string): Entry[] {
	try {
		return readFileSync(currentLogPath(diagnosticsDirectory(userDataDir), FRAMES_LOG_STEM), 'utf8')
			.split('\n')
			.filter((line) => line.length > 0)
			.map((line): unknown => JSON.parse(line))
			.filter(isRecord);
	} catch {
		return [];
	}
}

function isRecord(value: unknown): value is Entry {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function msIn(entry: Entry, key: string): number {
	const value = entry[key];
	return typeof value === 'number' ? value : Number.NaN;
}

function causesCaught(entries: readonly Entry[]): Record<string, boolean> {
	const stalls = entries.filter(
		(entry) => entry['process'] === 'main' && entry['kind'] === 'stall',
	);
	return {
		pageWork: entries.some(
			(entry) =>
				entry['kind'] === 'long-frame' &&
				Array.isArray(entry['scripts']) &&
				entry['scripts'].some(
					(script: unknown) => isRecord(script) && script['invoker'] === 'TimerHandler:setTimeout',
				),
		),
		mainThreadWork: stalls.some((stall) => stall['route'] === null && msIn(stall, 'cpuMs') >= 100),
		mainThreadFrozen: stalls.some(
			(stall) => msIn(stall, 'durationMs') >= 200 && msIn(stall, 'cpuMs') < 50,
		),
		gpuStall: entries.some((entry) => entry['kind'] === 'frame-gap'),
	};
}

test('slow frames on the page, main-thread stalls and a GPU stall land in the frame journal', async () => {
	const app = await launchMalini();
	let stopped: number | null = null;
	const pause = async (pid: number, ms: number): Promise<void> => {
		process.kill(pid, 'SIGSTOP');
		stopped = pid;
		await sleep(ms);
		process.kill(pid, 'SIGCONT');
		stopped = null;
	};
	try {
		const { page, electronApp } = app;
		await expect(page.getByRole('region', { name: /^Notifications/u })).toBeAttached({
			timeout: 20_000,
		});

		await page.evaluate(() => {
			setTimeout(() => {
				const blockedUntil = performance.now() + 150;
				while (performance.now() < blockedUntil);
			});
		});

		await electronApp.evaluate(({ BrowserWindow }) => {
			BrowserWindow.getAllWindows()[0]?.emit('focus');
		});
		const main = electronApp.process().pid;
		execFileSync('taskpolicy', ['-b', '-p', String(main)]);
		await sleep(100);
		if (process.env['SPIN'] === 'cpu') {
			await electronApp.evaluate(() => {
				const cpuMs = (): number => process.threadCpuUsage().user / 1_000 + process.threadCpuUsage().system / 1_000;
				const busyUntil = cpuMs() + 150;
				while (cpuMs() < busyUntil);
			});
		} else {
			await electronApp.evaluate(() => {
				const blockedUntil = performance.now() + 150;
				while (performance.now() < blockedUntil);
			});
		}
		expect(main).toEqual(expect.any(Number));
		if (main !== undefined) await pause(main, 300);

		const gpu = await electronApp.evaluate(
			({ app: electron }) => electron.getAppMetrics().find((metric) => metric.type === 'GPU')?.pid,
		);
		expect(gpu).toEqual(expect.any(Number));
		await page.mouse.move(40, 40);
		await sleep(100);
		if (gpu !== undefined) await pause(gpu, 200);

		await expect
			.poll(() => causesCaught(journaled(app.userDataDir)), { timeout: 10_000 })
			.toEqual({ pageWork: true, mainThreadWork: true, mainThreadFrozen: true, gpuStall: true });
		expectCleanConsole(app);
	} catch (error) {
		console.log('STALLS', JSON.stringify(journaled(app.userDataDir).filter((e) => e['kind'] === 'stall').map((e) => [e['durationMs'], e['cpuMs']])));
		throw error;
	} finally {
		if (stopped !== null) process.kill(stopped, 'SIGCONT');
		await app.close();
	}
});
