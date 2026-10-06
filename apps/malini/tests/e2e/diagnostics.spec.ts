import { chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import { readDiagnostics } from '../../src/main/diagnostics/diagnostics-files';
import {
	createSourceRepo,
	diagnosticText,
	invoke,
	launchMalini,
	seedWorkstream,
	unexpectedDiagnostics,
	waitForQuietDiagnostics,
} from './harness';

test('an archive that cannot move the checkout names the real reason, and the log records it', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ allowedDiagnostics: [/permission denied/u] });
	let lockedDirectory: string | null = null;
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-locked-ws', 'Locked workstream');
		await page.reload();
		const row = page.getByTestId('sidebar-workstream').filter({ hasText: 'Locked workstream' });
		await expect(row).toBeVisible({ timeout: 20_000 });

		lockedDirectory = dirname(seeded.worktree);
		chmodSync(lockedDirectory, 0o555);
		const archive = page.getByRole('button', { name: 'Archive Locked workstream' });
		await expect(async () => {
			await row.hover();
			await archive.click({ timeout: 1_000 });
		}).toPass({ timeout: 20_000 });

		const failure = page
			.getByTestId('toast')
			.filter({ hasText: 'Could not archive Locked workstream' });
		await expect(failure).toContainText('permission denied', { timeout: 20_000 });
		await expect(failure).not.toContainText('The checkout could not be removed');

		await waitForQuietDiagnostics(app.userDataDir);
		const recorded = unexpectedDiagnostics(app.userDataDir, []);
		expect(recorded).toContainEqual(
			expect.objectContaining({
				process: 'main',
				source: 'ipc-command',
				command: 'repositories.archive-workstream',
				workstreamId: 'e2e-locked-ws',
				message: expect.stringContaining('permission denied'),
				detail: expect.stringMatching(/^caused by Error: EACCES: permission denied/u),
			}),
		);
		expect(
			readDiagnostics(app.userDataDir).filter(
				(entry) => entry.source === 'toast' && entry.level === 'info',
			),
		).toEqual([
			expect.objectContaining({
				message: 'info toast, text not kept',
				workstreamId: 'e2e-locked-ws',
			}),
		]);
		expect(recorded).toContainEqual(
			expect.objectContaining({
				process: 'renderer',
				source: 'toast',
				level: 'error',
				message: expect.stringMatching(
					/^Could not archive Locked workstream · .*permission denied/u,
				),
			}),
		);
		expect(recorded.map(diagnosticText).every((text) => /permission denied/u.test(text))).toBe(
			true,
		);
	} finally {
		if (lockedDirectory) chmodSync(lockedDirectory, 0o755);
		await app.close();
	}
});

test('the built app records main-process warnings and unhandled rejections', async () => {
	const app = await launchMalini({ allowedDiagnostics: [/e2e probe/u] });
	try {
		await app.electronApp.evaluate(() => {
			console.warn('e2e probe: a main-process warning', { workstreamId: 'ws-probe' });
			void Promise.reject(new Error('e2e probe: an unhandled rejection'));
		});

		await expect
			.poll(() =>
				readDiagnostics(app.userDataDir)
					.filter((entry) => entry.message.includes('e2e probe'))
					.map((entry) => [entry.process, entry.source, entry.level, entry.workstreamId]),
			)
			.toEqual([
				['main', 'console', 'warn', 'ws-probe'],
				['main', 'unhandled-rejection', 'error', null],
			]);
	} finally {
		await app.close();
	}
});

test('the built app records a node process warning once, as a warning, and never as an error', async () => {
	const app = await launchMalini();
	try {
		await app.electronApp.evaluate(() => {
			process.emitWarning('e2e probe: this API is deprecated', 'DeprecationWarning', 'DEP9999');
		});

		await expect
			.poll(() =>
				readDiagnostics(app.userDataDir)
					.filter((entry) => entry.message.includes('e2e probe'))
					.map((entry) => [entry.source, entry.level, entry.message]),
			)
			.toEqual([
				['process-warning', 'warn', 'DeprecationWarning: e2e probe: this API is deprecated'],
			]);
	} finally {
		await app.close();
	}
});

test('the built app logs the routine startup lines as info, outside the warn view', async () => {
	const app = await launchMalini();
	try {
		await expect
			.poll(() =>
				readDiagnostics(app.userDataDir)
					.filter((entry) => entry.message.startsWith('agent: reaped'))
					.map((entry) => entry.level),
			)
			.toEqual(['info']);
		expect(
			readDiagnostics(app.userDataDir, { minimumLevel: 'warn' }).filter((entry) =>
				entry.message.startsWith('agent: reaped'),
			),
		).toEqual([]);
	} finally {
		await app.close();
	}
});

test('the harness fails a test whose app logged an error nobody allowed', async () => {
	test.fail();
	const app = await launchMalini();
	await settled(
		invoke(app.page, 'repositories.workstream-status', { workstreamId: 'no-such-workstream' }),
	);
	await app.close();
});

async function settled(pending: Promise<unknown>): Promise<void> {
	try {
		await pending;
	} catch {
		return;
	}
}
