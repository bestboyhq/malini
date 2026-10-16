import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

const DETECTION_TIMEOUT_MS = 15_000;

test('streamer mode blurs personal data on demand, and by itself while a streaming app runs', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	let streamingApp: ChildProcess | null = null;
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-streamer-ws', 'Streamer');
		await openWorkstream(page, workstreamId);
		const streamerMode = page.getByRole('group', { name: 'Streamer mode' });
		const signedIn = page.getByTestId('claude-code-setup').getByTestId('claude-code-detail');
		const reveal = signedIn.getByRole('button', { name: 'Reveal email address' });

		await openSettings(page, 'privacy');
		await expect(streamerMode.getByRole('button', { name: 'Auto' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await streamerMode.getByRole('button', { name: 'Off' }).click();
		await openSettings(page, '');
		await expect(signedIn).toContainText('Signed in as e2e@example.com');
		await expect(reveal).toHaveCount(0);

		streamingApp = launchStandInObs(app.root);
		await openSettings(page, 'privacy');
		await streamerMode.getByRole('button', { name: 'Auto' }).click();
		await expect(page.getByTestId('streamer-mode-detected')).toBeVisible({
			timeout: DETECTION_TIMEOUT_MS,
		});
		await captureFlow(app, 'streamer-mode-auto-detected');
		await openSettings(page, '');
		await expect(reveal).toBeVisible();

		await openSettings(page, 'privacy');
		await streamerMode.getByRole('button', { name: 'On' }).click();
		await openSettings(page, '');
		await page.reload();
		await expect(reveal).toBeVisible();
		await reveal.click();
		await expect(reveal).toHaveCount(0);
		await expect(signedIn).toContainText('Signed in as e2e@example.com');

		await openSettings(page, 'privacy');
		await streamerMode.getByRole('button', { name: 'Off' }).click();
		await expect(page.getByTestId('streamer-mode-detected')).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		streamingApp?.kill();
		await app.close();
	}
});

async function openSettings(page: Page, section: string): Promise<void> {
	await page.evaluate(
		(hash) => {
			location.hash = hash;
		},
		`#/settings${section ? `/${section}` : ''}`,
	);
}

function launchStandInObs(root: string): ChildProcess {
	const bundle = join(root, 'OBS.app', 'Contents', 'MacOS');
	mkdirSync(bundle, { recursive: true });
	const executable = join(bundle, 'OBS');
	copyFileSync('/bin/sleep', executable);
	execFileSync('codesign', ['--force', '--sign', '-', executable], { stdio: 'ignore' });
	return spawn(executable, ['600'], { stdio: 'ignore' });
}
