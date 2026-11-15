import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	APP_ROOT,
	expectPicker,
	invoke,
	launchMalini,
	prepareProfile,
	type RuntimeInfo,
} from './harness';

const electronBinary = createRequire(__filename)('electron') as string;

function running(pid: number): boolean {
	if (pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
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

test('the built app opens a window on a runtime whose SQLite is the bundled one', async () => {
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;

		await expect(page).toHaveTitle('Malini · Repositories');
		await expectPicker(page);

		const runtime = await invoke<RuntimeInfo>(page, 'app.runtime-info', undefined);
		expect(runtime.app).toBe('0.1.0');
		expect(runtime.node).toMatch(/^24\./u);
		expect(runtime.sqlite).toMatch(/^\d+\.\d+\.\d+$/u);

		const bundledAppVersion = await electronApp.evaluate(({ app: electronAppVersion }) =>
			electronAppVersion.getVersion(),
		);
		expect(bundledAppVersion).toBe('0.1.0');
	} finally {
		await app.close();
	}
});

test('a test run keeps the app off the screen of whoever is using the machine', async () => {
	const app = await launchMalini();
	try {
		await expect(app.page).toHaveTitle('Malini · Repositories');
		const onScreen = await app.electronApp.evaluate(({ BrowserWindow, screen }) => {
			const [window] = BrowserWindow.getAllWindows();
			if (!window) throw new Error('malini opened no window');
			const bounds = window.getBounds();
			return screen.getAllDisplays().map(({ bounds: display }) => {
				const width = Math.min(bounds.x + bounds.width, display.x + display.width);
				const height = Math.min(bounds.y + bounds.height, display.y + display.height);
				return (
					Math.max(0, width - Math.max(bounds.x, display.x)) *
					Math.max(0, height - Math.max(bounds.y, display.y))
				);
			});
		});
		expect(Math.max(...onScreen)).toBeLessThanOrEqual(800);
	} finally {
		await app.close();
	}
});

test('quitting waits on no store Chromium writes from a throttled background thread', async () => {
	const app = await launchMalini();
	try {
		await expect(app.page).toHaveTitle('Malini · Repositories');
		await app.quit();
		expect(
			readdirSync(app.userDataDir).filter(
				(name) => name.startsWith('declarative_performance_observer') || name.startsWith('DIPS'),
			),
		).toEqual([]);
	} finally {
		await app.close();
	}
});

test('a test run composites without the GPU, so quitting never waits on a Metal fence', async () => {
	const app = await launchMalini();
	try {
		await expect(app.page).toHaveTitle('Malini · Repositories');
		const compositing = await app.electronApp.evaluate(
			({ app: electronApp }) => electronApp.getGPUFeatureStatus().gpu_compositing,
		);
		expect(compositing).toMatch(/^disabled/u);
	} finally {
		await app.close();
	}
});

test('an app whose test run is killed quits instead of running on behind every window', async () => {
	test.setTimeout(60_000);
	const profile = prepareProfile();
	const pidFile = join(profile.root, 'malini.pid');
	const runner = spawn(
		'/bin/sh',
		[
			'-c',
			`"$0" "$@" & echo $! > '${pidFile}'; wait`,
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
	const malini = (): number => (existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8')) : 0);
	try {
		await expect
			.poll(() => windowTitles(output), { timeout: 30_000 })
			.toContain('Malini · Repositories');
		expect(running(malini())).toBe(true);

		runner.kill('SIGKILL');

		await expect.poll(() => running(malini()), { timeout: 20_000 }).toBe(false);
	} finally {
		runner.kill('SIGKILL');
		if (running(malini())) process.kill(malini(), 'SIGKILL');
	}
});
