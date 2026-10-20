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
		await expect(gallery.getByRole('button', { name: 'Close', exact: true })).toHaveCSS(
			'-webkit-app-region',
			'no-drag',
		);

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
		const picture = gallery.getByRole('img', { name: 'mockup.png' });
		await expect(picture).toBeVisible();
		const shown = await picture.boundingBox();
		if (!shown) throw new Error('the gallery shows no image');
		const width = async (): Promise<number> => (await picture.boundingBox())?.width ?? 0;
		const top = async (): Promise<number> => (await picture.boundingBox())?.y ?? 0;
		const zoom = gallery.getByRole('group', { name: 'Zoom' });

		await page.keyboard.press('+');
		await expect(zoom.getByRole('button', { name: 'Fit to screen from 1.5×' })).toBeEnabled();
		await zoom.getByRole('button', { name: 'Zoom in' }).click();
		await expect(zoom.getByRole('button', { name: 'Fit to screen from 2.3×' })).toBeEnabled();
		await expect.poll(width).toBeGreaterThan(shown.width * 2);
		await page.keyboard.press('0');
		await expect(zoom.getByRole('button', { name: 'Fit to screen', exact: true })).toBeDisabled();
		await expect.poll(width).toBeLessThan(shown.width * 1.1);

		const center = { x: shown.x + shown.width / 2, y: shown.y + shown.height / 2 };
		await page.mouse.click(center.x, center.y);
		await expect(zoom.getByRole('button', { name: 'Fit to screen from 2.5×' })).toBeEnabled();
		const before = await top();
		await page.mouse.move(center.x, center.y);
		await page.mouse.down();
		await page.mouse.move(center.x, center.y + 60, { steps: 6 });
		await page.mouse.up();
		await expect.poll(top).toBeGreaterThan(before + 30);
		await expect(zoom.getByRole('button', { name: 'Fit to screen from 2.5×' })).toBeEnabled();
		await page.mouse.click(center.x, center.y);
		await expect(zoom.getByRole('button', { name: 'Fit to screen', exact: true })).toBeDisabled();

		await page.keyboard.down('Meta');
		await page.mouse.wheel(0, -100);
		await page.keyboard.up('Meta');
		await expect(zoom.getByRole('button', { name: /^Fit to screen from / })).toBeEnabled();
		await page.keyboard.press('0');
		await expect.poll(width).toBeLessThan(shown.width * 1.1);

		const tooltip = page.getByRole('tooltip');
		await zoom.getByRole('button', { name: 'Zoom in' }).hover();
		await expect(tooltip).toHaveText('Zoom in (+)');
		await zoom.getByRole('button', { name: 'Zoom out' }).hover();
		await expect(tooltip).toHaveText('Zoom out (-)');
		await expect(tooltip).toHaveCount(1);

		await page.mouse.click(shown.x - 24, shown.y + shown.height / 2);
		await expect(gallery).toBeHidden();

		await page.getByRole('button', { name: /^Edit message: / }).click({ position: { x: 4, y: 4 } });
		const editor = page.getByRole('textbox', { name: 'Edit message' });
		await expect(editor).toBeVisible();
		const after = await page
			.getByRole('button', { name: 'Open image shots/after.png in gallery' })
			.boundingBox();
		if (!after) throw new Error('the shown image is not on screen');
		await page.mouse.move(after.x + after.width / 2, after.y + after.height / 2);
		await page.mouse.down();
		await expect(editor, 'the editor holds still until the press ends').toBeVisible();
		await page.mouse.up();
		await expect(editor).toBeHidden();
		await expect(gallery.getByRole('status')).toHaveText('3 of 3');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('closing the gallery leaves no image preview open on the chip that opened it', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-gallery-hover', 'Gallery hover');
		mkdirSync(join(seeded.worktree, 'shots'), { recursive: true });
		copyFileSync(ICON, join(seeded.worktree, 'shots/before.png'));
		await openWorkstream(page, seeded.workstreamId);
		await sendPrompt(page, 'READ_IMAGE:shots/before.png');
		await expectAssistantReply(page);

		const chip = page.getByRole('button', { name: 'Open image before.png in gallery' });
		const preview = page.getByTestId('tool-image-hovercard');
		const gallery = page.getByRole('dialog', { name: 'Image gallery' });
		for (const close of ['scrim', 'Escape'] as const) {
			await chip.hover();
			await expect(preview).toBeVisible();
			await chip.click();
			await expect(gallery.getByRole('img', { name: 'before.png' })).toBeVisible();
			if (close === 'Escape') {
				await page.mouse.move(4, 4);
				await page.keyboard.press('Escape');
			} else {
				const shown = await gallery.getByRole('img', { name: 'before.png' }).boundingBox();
				if (!shown) throw new Error('the gallery shows no image');
				await page.mouse.click(shown.x - 24, shown.y + shown.height / 2);
			}
			await expect(gallery).toBeHidden();
			await page.waitForTimeout(600);
			await expect(preview, `preview after closing with ${close}`).toBeHidden();
			await expect(page.getByRole('tooltip')).toHaveCount(0);
		}
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('an image the agent read outside the worktree previews on hover and opens in the gallery', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-gallery-outside', 'Gallery outside');
		const outside = join(app.root, 'scratch/frames.png');
		mkdirSync(join(app.root, 'scratch'), { recursive: true });
		copyFileSync(ICON, outside);
		await openWorkstream(page, seeded.workstreamId);
		await sendPrompt(page, `READ_IMAGE:${outside}`);
		await expectAssistantReply(page);

		const chip = page.getByRole('button', { name: 'Open image frames.png in gallery' });
		await chip.hover();
		await expect(page.getByTestId('tool-image-preview-image')).toBeVisible();
		await expect(page.getByTestId('tool-image-preview')).toContainText(outside);

		await chip.click();
		const gallery = page.getByRole('dialog', { name: 'Image gallery' });
		await expect(gallery.getByRole('img', { name: 'frames.png' })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
