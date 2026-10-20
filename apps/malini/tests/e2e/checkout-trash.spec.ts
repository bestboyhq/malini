import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { captureFlow, expectCleanConsole, fileExists, launchMalini } from './harness';

const electronBinary = createRequire(__filename)('electron') as string;
const asarArchive = join(dirname(electronBinary), '..', 'Resources', 'default_app.asar');

test('boot empties a trashed checkout whose node_modules holds an asar archive', async () => {
	const root = mkdtempSync(join(tmpdir(), 'malini-e2e-'));
	const trashed = join(root, 'user-data', 'workstreams', '.trash', `gone-ws-${Date.now()}`);
	const resources = join(trashed, 'node_modules', 'electron', 'dist', 'Resources');
	mkdirSync(resources, { recursive: true });
	copyFileSync(asarArchive, join(resources, 'default_app.asar'));

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
