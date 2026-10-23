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

test('streamer mode masks personal data on demand, and by itself while a streaming app runs', async () => {
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

test('streamer mode hides the home folder in a typed path until the field is focused', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		await seedWorkstream(page, source, 'e2e-streamer-field-ws', 'Streamer field');
		await openSettings(page, 'privacy');
		await page
			.getByRole('group', { name: 'Streamer mode' })
			.getByRole('button', { name: 'On' })
			.click();
		await closeSettings(page);
		await page.evaluate(() => {
			location.hash = '#/';
		});
		await page.getByRole('button', { name: 'Clone a GitHub repository' }).first().click();
		const dialog = page.getByRole('dialog', { name: 'Clone GitHub repo' });
		const url = dialog.getByLabel('Repository URL');
		const mask = dialog.getByTestId('sensitive-field-mask');
		const homePath = 'file:///Users/ada/repos/hutch';

		await url.fill(homePath);
		await expect(mask).toHaveCount(0);
		await url.blur();
		await expect(mask).toBeVisible();
		await expect(mask).toHaveText('file:///Users/a***/repos/hutch');
		await expect(url).toHaveValue(homePath);
		await captureFlow(app, 'streamer-mode-field-masked');

		await url.focus();
		await expect(mask).toHaveCount(0);
		await url.blur();
		await expect(mask).toBeVisible();

		await url.fill('https://github.com/ada/hutch.git');
		await url.blur();
		await expect(mask).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
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

async function closeSettings(page: Page): Promise<void> {
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
	await expect(page).not.toHaveURL(/#\/settings/u);
}

test('streamer mode masks an email and a home folder with asterisks, in the composer too', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-streamer-mask', 'Masked');
		await openSettings(page, 'privacy');
		await page
			.getByRole('group', { name: 'Streamer mode' })
			.getByRole('button', { name: 'On' })
			.click();
		await closeSettings(page);
		await openWorkstream(page, workstreamId);
		const composer = page.locator('[data-testid="chat-composer-input"][aria-disabled="false"]');
		await composer.click();
		await page.keyboard.type('Mail ada.lovelace@example.com about /Users/ada/notes.md');
		await expect(page.getByRole('status').filter({ hasText: 'No job matches' })).toHaveText(
			'No job matches “/Users/a***/notes.md”',
		);
		await page.getByRole('button', { name: 'View MCP server status' }).focus();
		await expect(composer).toContainText('Mail a***e@*** about /Users/a***/notes.md', {
			useInnerText: true,
		});
		await captureFlow(app, 'streamer-mode-composer');
		await composer.click();
		await expect(composer).toContainText(
			'Mail ada.lovelace@example.com about /Users/ada/notes.md',
			{ useInnerText: true },
		);

		await openSettings(page, '');
		const signedIn = page.getByTestId('claude-code-setup').getByTestId('claude-code-detail');
		await expect(signedIn).toContainText('Signed in as e***@***');
		await captureFlow(app, 'streamer-mode-account');
		await signedIn.getByRole('button', { name: 'Reveal email address' }).click();
		await expect(signedIn).toContainText('Signed in as e2e@example.com');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

function launchStandInObs(root: string): ChildProcess {
	const bundle = join(root, 'OBS.app', 'Contents', 'MacOS');
	mkdirSync(bundle, { recursive: true });
	const executable = join(bundle, 'OBS');
	copyFileSync('/bin/sleep', executable);
	execFileSync('codesign', ['--force', '--sign', '-', executable], { stdio: 'ignore' });
	return spawn(executable, ['600'], { stdio: 'ignore' });
}
