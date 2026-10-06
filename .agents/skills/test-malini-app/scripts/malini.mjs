import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const appRoot = join(root, 'apps/malini');
const contextRoot = join(root, '.context');
const { _electron: electron } = createRequire(join(appRoot, 'package.json'))('@playwright/test');

export async function launch(topic, { foreground = false } = {}) {
	const userDataDir = join(contextRoot, `profile-${topic}`);
	mkdirSync(userDataDir, { recursive: true });
	const app = await electron.launch({
		args: ['.', `--user-data-dir=${userDataDir}`],
		cwd: appRoot,
		env: {
			...process.env,
			MALINI_USAGE_DATA: 'off',
			...(foreground ? {} : { MALINI_BACKGROUND_WINDOW: '1' }),
		},
	});
	const page = await app.firstWindow();
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
		const source = await app.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0]?.getMediaSourceId(),
		);
		const windowId = /^window:(\d+)/u.exec(source ?? '')?.[1];
		if (!windowId) throw new Error('malini has no window to capture');
		const path = join(contextRoot, `${name}.png`);
		execFileSync('screencapture', ['-o', '-x', '-l', windowId, path]);
		return path;
	}

	return { app, page, errors, shot, close: () => app.close() };
}
