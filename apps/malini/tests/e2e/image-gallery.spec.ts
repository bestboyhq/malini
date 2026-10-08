import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	APP_ROOT,
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

const ICON = join(APP_ROOT, 'build/icon.png');
const AVATAR = join(APP_ROOT, 'build/malini-agent.png');

async function pasteImage(page: Page, path: string, name: string): Promise<void> {
	const base64 = readFileSync(path).toString('base64');
	const input = page.getByTestId('chat-composer-input');
	await input.click();
	await page.evaluate(`(() => {
		const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), (char) => char.charCodeAt(0));
		const data = new DataTransfer();
		data.items.add(new File([bytes], ${JSON.stringify(name)}, { type: 'image/png' }));
		document
			.querySelector('[data-testid="chat-composer-input"]')
			.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
	})()`);
	await expect(input.getByLabel(`Attached file: ${name}`)).toBeVisible({ timeout: 20_000 });
}

test('clicking an image in a chat browses every image of the chat in one gallery', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-gallery-ws', 'Gallery workstream');
		mkdirSync(join(seeded.worktree, 'shots'), { recursive: true });
		copyFileSync(ICON, join(seeded.worktree, 'shots/before.png'));
		copyFileSync(AVATAR, join(seeded.worktree, 'shots/after.png'));
		await openWorkstream(page, seeded.workstreamId);

		await pasteImage(page, AVATAR, 'mockup.png');
		await sendPrompt(page, ' READ_IMAGE:shots/before.png SHOW_IMAGE:shots/after.png');
		await expectAssistantReply(page);

		const opener = page.getByRole('button', { name: 'Open image mockup.png in gallery' });
		await opener.click();
		const gallery = page.getByRole('dialog', { name: 'Image gallery' });
		await expect(gallery.getByRole('status')).toHaveText('1 of 3');
		await expect(gallery.getByRole('img', { name: 'mockup.png' })).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(gallery).toBeHidden();
		await expect(opener).toBeFocused();
		await page.getByRole('button', { name: 'Open image before.png in gallery' }).click();
		await expect(gallery.getByRole('status')).toHaveText('2 of 3');
		await page.keyboard.press('ArrowLeft');
		await expect(gallery.getByRole('status')).toHaveText('1 of 3');

		await page.keyboard.press('ArrowRight');
		await expect(gallery.getByRole('status')).toHaveText('2 of 3');
		await expect(gallery.getByRole('img', { name: 'before.png' })).toBeVisible();
		await captureFlow(app, 'image-gallery');

		await gallery.getByRole('button', { name: 'Next image' }).click();
		await expect(gallery.getByRole('status')).toHaveText('3 of 3');
		await expect(gallery.getByRole('img', { name: 'shots/after.png' })).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(gallery).toBeHidden();

		await page.getByRole('button', { name: 'Open image shots/after.png in gallery' }).click();
		await expect(gallery.getByRole('status')).toHaveText('3 of 3');
		const thumbnails = gallery.getByRole('group', { name: 'All images' });
		await expect(thumbnails.getByRole('button')).toHaveCount(3);
		await thumbnails.getByRole('button', { name: 'Show image mockup.png' }).click();
		await expect(gallery.getByRole('status')).toHaveText('1 of 3');
		await expect(thumbnails.getByRole('button', { name: 'Show image mockup.png' })).toHaveAttribute(
			'aria-current',
			'true',
		);
		await expect(gallery.getByRole('img', { name: 'mockup.png' })).toBeVisible();

		const shown = await gallery.getByRole('img', { name: 'mockup.png' }).boundingBox();
		if (!shown) throw new Error('the gallery shows no image');
		await page.mouse.click(shown.x - 24, shown.y + shown.height / 2);
		await expect(gallery).toBeHidden();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
