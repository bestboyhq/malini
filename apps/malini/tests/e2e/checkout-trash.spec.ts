import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	ELECTRON_DEFAULT_APP,
	expectCleanConsole,
	fileExists,
	launchMalini,
	temporaryRoot,
} from './harness';

test('boot empties a trashed checkout whose node_modules holds an asar archive', async () => {
	const root = temporaryRoot();
	const trashed = join(
		root,
		'user-data',
		'checkouts',
		'workstreams',
		'.trash',
		`gone-ws-${Date.now()}`,
	);
	const resources = join(trashed, 'node_modules', 'electron', 'dist', 'Resources');
	mkdirSync(resources, { recursive: true });
	copyFileSync(ELECTRON_DEFAULT_APP, join(resources, 'default_app.asar'));

	const app = await launchMalini({ profile: root });
	try {
		await expect(app.page).toHaveTitle('Malini · Repositories');
		await expect.poll(() => fileExists(trashed), { timeout: 20_000 }).toBe(false);
		await captureFlow(app, 'checkout-trash');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
