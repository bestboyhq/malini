import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
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

test('an image the agent read shows its new pixels once the agent overwrites it', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-image-fresh', 'Image freshness');
		mkdirSync(join(seeded.worktree, 'shots'), { recursive: true });
		copyFileSync(ICON, join(seeded.worktree, 'shots/screen.png'));
		await openWorkstream(page, seeded.workstreamId);
		await sendPrompt(page, 'READ_IMAGE:shots/screen.png');
		await expectAssistantReply(page);

		const preview = page.getByTestId('tool-image-preview');
		const image = page.getByTestId('tool-image-preview-image');
		const screen = page.getByRole('button', { name: 'Open image screen.png in gallery' });
		await screen.hover();
		await expect(image).toBeVisible({ timeout: 20_000 });
		const before = await image.getAttribute('src');
		await page.mouse.move(4, 4);
		await expect(preview).toBeHidden();

		copyFileSync(AVATAR, join(seeded.worktree, 'shots/screen.png'));
		await expect
			.poll(
				async () => {
					await screen.hover();
					const src = await image.getAttribute('src', { timeout: 5_000 });
					await page.mouse.move(4, 4);
					return src;
				},
				{ timeout: 30_000 },
			)
			.not.toBe(before);

		await captureFlow(app, 'agent-image-overwritten');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
