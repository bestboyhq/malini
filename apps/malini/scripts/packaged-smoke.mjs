import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';

const ARCH = process.arch === 'x64' ? '' : `-${process.arch}`;
const EXECUTABLES = {
	darwin: `mac${ARCH}/Malini.app/Contents/MacOS/Malini`,
	win32: `win${ARCH}-unpacked/Malini.exe`,
	linux: `linux${ARCH}-unpacked/malini`,
};

const userData = mkdtempSync(join(tmpdir(), 'malini-packaged-smoke-'));
const app = await electron.launch({
	executablePath: resolve(import.meta.dirname, '../release', EXECUTABLES[process.platform]),
	args: [`--user-data-dir=${userData}`, '--use-mock-keychain'],
	env: {
		...process.env,
		MALINI_BACKGROUND_WINDOW: '1',
		MALINI_USAGE_DATA: 'off',
		MALINI_CLAUDE_UPDATES: 'off',
	},
});
try {
	const page = await app.firstWindow();
	await page.evaluate(() =>
		globalThis.malini.invoke('app.set-setting', {
			key: 'onboarding.finished-at',
			value: new Date().toISOString(),
		}),
	);
	await page.reload();
	await page.waitForFunction("document.title === 'Malini · Repositories'", null, {
		timeout: 60_000,
	});
	console.log(`ok: the packaged build booted to ${await page.title()}`);
	const printed = await app.evaluate(
		({ app: packaged }) =>
			new Promise((settle, fail) => {
				const windows = process.platform === 'win32';
				const { createRequire } = process.mainModule.constructor;
				const terminal = createRequire(`${packaged.getAppPath()}/package.json`)('node-pty').spawn(
					windows ? (process.env.ComSpec ?? 'cmd.exe') : '/bin/sh',
					windows ? ['/d', '/c', 'echo packaged pty'] : ['-c', 'echo packaged pty'],
					{ cols: 80, rows: 24 },
				);
				let output = '';
				terminal.onData((text) => (output += text));
				terminal.onExit(({ exitCode }) =>
					exitCode === 0 ? settle(output) : fail(new Error(`exit ${exitCode}: ${output}`)),
				);
				setTimeout(() => fail(new Error(`no exit in 20 s: ${output}`)), 20_000);
			}),
	);
	if (!printed.includes('packaged pty')) throw new Error(`the pty printed ${printed}`);
	console.log('ok: Run starts a terminal from the packaged node-pty');
} finally {
	await app.close();
}
