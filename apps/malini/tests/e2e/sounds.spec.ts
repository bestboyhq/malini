import { copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { CustomSound } from '../../src/contract/sounds';
import {
	APP_ROOT,
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	invoke,
	launchMalini,
	openedUrls,
	recordBrowser,
	seedWorkstream,
	type LaunchedApp,
} from './harness';

const BUNDLED_SOUND = join(APP_ROOT, 'src/renderer/public/sounds/rhea.flac');

async function storedSettings(page: Page): Promise<Record<string, string>> {
	return invoke<Record<string, string>>(page, 'app.list-settings', undefined);
}

async function openSoundSettings(app: LaunchedApp): Promise<void> {
	const { page } = app;
	await seedWorkstream(page, await createSourceRepo(app.root), 'e2e-sounds-ws', 'Sounds');
	await page.evaluate(() => {
		location.hash = '#/settings/sounds';
	});
	await page.reload();
	await expect(
		page
			.getByRole('navigation', { name: 'Settings' })
			.getByRole('link', { name: 'Sounds', exact: true }),
	).toHaveAttribute('aria-current', 'page');
}

async function pickFileWith(app: LaunchedApp, path: string): Promise<void> {
	await app.electronApp.evaluate(({ dialog }, picked) => {
		dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
	}, path);
}

test('setup asks which sound plays when an agent finishes and when it needs you, and lets you try an afternoon', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const setup = page.getByTestId('onboarding');
		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Meet your jobs' })).toBeVisible();
		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Hear your afternoon' })).toBeVisible();
		await expect(setup.getByText('Step 3 of 4')).toBeVisible();

		const finished = setup.getByRole('button', { name: /^Finished sound:/u });
		const needsYou = setup.getByRole('button', { name: /^Needs you sound:/u });
		await expect(finished).toHaveAccessibleName('Finished sound: Malini chime');
		await expect(needsYou).toHaveAccessibleName('Needs you sound: Tethys');

		await needsYou.click();
		const menu = page.getByRole('menu', { name: 'Needs you sound' });
		await menu.getByRole('menuitemradio', { name: 'Ariel' }).click();
		await expect(menu).toBeVisible();
		await menu.getByRole('menuitemradio', { name: 'Shaula' }).click();
		await expect(menu.getByRole('menuitemradio', { name: 'Shaula' })).toHaveAttribute(
			'aria-checked',
			'true',
		);
		await expect(menu.getByRole('menuitemradio', { name: 'Ariel' })).toHaveAttribute(
			'aria-checked',
			'false',
		);
		await page.keyboard.press('Escape');
		await expect(menu).toHaveCount(0);
		await expect(needsYou).toHaveAccessibleName('Needs you sound: Shaula');
		await expect.poll(async () => (await storedSettings(page))['sounds.needs-you']).toBe('shaula');

		await finished.click();
		await page
			.getByRole('menu', { name: 'Finished sound' })
			.getByRole('menuitemradio', { name: 'No sound' })
			.click();
		await page.keyboard.press('Escape');
		await expect(setup.getByRole('button', { name: 'Play the finished sound' })).toBeDisabled();
		await expect.poll(async () => (await storedSettings(page))['sounds.finished']).toBe('none');

		const tryIt = setup.getByRole('button', { name: 'Try it' });
		await tryIt.click();
		const stop = setup.getByRole('button', { name: 'Stop' });
		await expect(stop).toHaveAttribute('aria-pressed', 'true');
		await captureFlow(app, 'sounds-onboarding-try-it');
		await stop.click();
		await expect(tryIt).toHaveAttribute('aria-pressed', 'false');

		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Open your first repository' })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Settings → Sounds adds a sound file you choose to both lists, and refuses one it cannot play', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ allowedDiagnostics: [/Malini can’t play Not a sound\.mp3/u] });
	try {
		const { page } = app;
		await openSoundSettings(app);
		const finished = page.getByRole('button', { name: /^Finished sound:/u });
		const needsYou = page.getByRole('button', { name: /^Needs you sound:/u });

		const fake = join(app.root, 'Not a sound.mp3');
		writeFileSync(fake, 'this is text, not audio');
		await pickFileWith(app, fake);
		await finished.click();
		await page.getByRole('menuitem', { name: 'Choose a file…' }).click();
		await expect(page.getByText('Malini can’t play Not a sound.mp3')).toBeVisible();
		expect(await invoke<CustomSound[]>(page, 'sounds.list', undefined)).toEqual([]);

		const doorbell = join(app.root, 'Doorbell.flac');
		copyFileSync(BUNDLED_SOUND, doorbell);
		await pickFileWith(app, doorbell);
		await finished.click();
		await page.getByRole('menuitem', { name: 'Choose a file…' }).click();
		await expect(finished).toHaveAccessibleName('Finished sound: Doorbell');
		const sounds = await invoke<CustomSound[]>(page, 'sounds.list', undefined);
		expect(sounds).toEqual([expect.objectContaining({ label: 'Doorbell', kind: 'file' })]);
		await expect
			.poll(async () => (await storedSettings(page))['sounds.finished'])
			.toBe(sounds[0]?.id);

		await needsYou.click();
		await expect(
			page
				.getByRole('menu', { name: 'Needs you sound' })
				.getByRole('menuitemradio', { name: 'Doorbell' }),
		).toHaveAttribute('aria-checked', 'false');
		await captureFlow(app, 'sounds-settings-your-sound');
		await page.keyboard.press('Escape');

		await page.reload();
		await expect(finished).toHaveAccessibleName('Finished sound: Doorbell');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('recording a sound asks for the microphone first, and points you to System Settings when it is off', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await app.electronApp.evaluate(({ systemPreferences }) => {
			systemPreferences.getMediaAccessStatus = () => 'denied';
		});
		await recordBrowser(app);
		await openSoundSettings(app);

		await page.getByRole('button', { name: /^Needs you sound:/u }).click();
		await page.getByRole('menuitem', { name: 'Record a sound…' }).click();
		await expect(page.getByText('Malini can’t use your microphone.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Start recording' })).toHaveCount(0);

		await page.getByRole('button', { name: 'Open System Settings' }).click();
		await expect
			.poll(() => openedUrls(app))
			.toEqual(['x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone']);

		await page.getByRole('button', { name: 'Cancel recording' }).click();
		await expect(page.getByText('Malini can’t use your microphone.')).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
