import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const appRoot = join(root, 'apps/malini');
const contextRoot = join(root, '.context');
const { _electron: electron } = createRequire(join(appRoot, 'package.json'))('@playwright/test');
const REPAINT_MS = 300;

export async function launch(topic, { foreground = false } = {}) {
	const userDataDir = join(realpathSync(tmpdir()), `malini-profile-${topic}`);
	mkdirSync(userDataDir, { recursive: true });
	const theme = process.env.MALINI_THEME;
	const app = await electron.launch({
		args: ['.', `--user-data-dir=${userDataDir}`],
		cwd: appRoot,
		colorScheme: theme === 'light' || theme === 'dark' ? theme : null,
		env: {
			...process.env,
			MALINI_USAGE_DATA: 'off',
			...(foreground ? {} : { MALINI_BACKGROUND_WINDOW: '1' }),
		},
	});
	const page = await app.firstWindow().catch(async (error) => {
		await app.close();
		throw error;
	});
	const errors = [];
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	page.on('pageerror', (error) => errors.push(error.message));

	async function shot(name) {
		await page.waitForFunction(() =>
			document
				.getAnimations()
				.every(
					(animation) =>
						animation.playState !== 'running' ||
						animation.effect?.getTiming().iterations === Infinity,
				),
		);
		await app.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0]?.webContents.invalidate(),
		);
		await page.waitForTimeout(REPAINT_MS);
		const source = await app.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0]?.getMediaSourceId(),
		);
		const windowId = /^window:(\d+)/u.exec(source ?? '')?.[1];
		if (!windowId) throw new Error('Malini has no window to capture');
		mkdirSync(contextRoot, { recursive: true });
		const path = join(contextRoot, `${name}.png`);
		execFileSync('screencapture', ['-o', '-x', '-l', windowId, path]);
		return path;
	}

	return { app, page, errors, shot, close: () => app.close() };
}
