import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';

const userData = mkdtempSync(join(tmpdir(), 'malini-packaged-smoke-'));
const app = await electron.launch({
	executablePath: resolve(
		import.meta.dirname,
		'../release/mac-arm64/Malini.app/Contents/MacOS/Malini',
	),
	args: [`--user-data-dir=${userData}`, '--use-mock-keychain'],
	env: { ...process.env, MALINI_BACKGROUND_WINDOW: '1', MALINI_USAGE_DATA: 'off' },
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
	console.log(`ok: the signed build booted to ${await page.title()}`);
} finally {
	await app.close();
}
