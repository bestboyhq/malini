import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	APP_ROOT,
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	untilStill,
} from './harness';

const MEDIA = join(APP_ROOT, 'tests/e2e/fixtures/report-media');

async function seedReport(
	page: Page,
	root: string,
	name: string,
	report: string,
	media: readonly string[],
): Promise<void> {
	const source = await createSourceRepo(root, name);
	const seeded = await seedWorkstream(page, source, `e2e-${name}`, name);
	mkdirSync(join(seeded.worktree, '.context'), { recursive: true });
	for (const file of media)
		copyFileSync(join(MEDIA, file), join(seeded.worktree, '.context', file));
	writeFileSync(join(seeded.worktree, 'report.md'), report);
	await openWorkstream(page, seeded.workstreamId);
	await sendPrompt(page, 'Show me REPLY_FILE:report.md');
}

async function frameHeight(frame: Locator): Promise<number> {
	const box = await frame.boundingBox();
	if (!box) throw new Error('the comparison frame is not on screen');
	return box.height;
}

test('a before and after shows as one picture that wipes, flips and diffs at one height, and zooms into each change', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await seedReport(
			page,
			app.root,
			'report-compare',
			[
				'![Before: pricing page](.context/before.png)',
				'![After: pricing page](.context/after.png)',
				'',
				'- Changed: the Pro button is solid and says Start free trial.',
				'- Verified: contrast 7.1:1 in light and dark.',
				'',
				'Outcome: The Pro button is the primary action.',
				'Needs: nothing',
			].join('\n'),
			['before.png', 'after.png'],
		);
		const card = page.getByRole('article', { name: 'Turn result' });
		const compare = card.getByTestId('report-image-compare');
		const frame = compare.getByRole('group', { name: 'Before and after' });
		await expect(frame).toBeVisible({ timeout: 30_000 });
		await expect(card.getByRole('img', { name: 'Changed' })).toBeVisible();
		await expect(card.getByRole('img', { name: 'Verified' })).toBeVisible();
		const modes = compare.getByRole('group', { name: 'Compare mode' });
		const diff = modes.getByRole('button', { name: 'Diff' });
		await expect(diff).toBeEnabled({ timeout: 20_000 });
		const changes = frame.getByRole('button', { name: /^Change \d$/u });
		await expect(changes).toHaveCount(3);
		await untilStill(page);

		const wipeHeight = await frameHeight(frame);
		await expect(
			frame.getByRole('slider', { name: 'Wipe between before and after' }),
		).toBeVisible();
		await modes.getByRole('button', { name: 'Flip' }).click();
		const flip = frame.getByRole('button', { name: 'Showing after, click to show before' });
		await flip.click();
		await expect(
			frame.getByRole('button', { name: 'Showing before, click to show after' }),
		).toHaveAttribute('aria-pressed', 'true');
		expect(await frameHeight(frame)).toBeCloseTo(wipeHeight, 0);
		await diff.click();
		await expect(frame.getByText('3 changed areas')).toBeVisible();
		expect(await frameHeight(frame)).toBeCloseTo(wipeHeight, 0);

		await changes.nth(2).click();
		await expect(frame.getByRole('button', { name: 'Show all' })).toBeVisible();
		await expect(changes.nth(2)).toHaveAttribute('aria-pressed', 'true');
		expect(await frameHeight(frame)).toBeCloseTo(wipeHeight, 0);
		await captureFlow(app, 'report-compare-zoomed-diff');
		await page.keyboard.press('Escape');
		await expect(frame.getByRole('button', { name: 'Show all' })).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('two recordings play on one timeline, step a frame at a time and jump to the moment the agent marked', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await seedReport(
			page,
			app.root,
			'report-motion',
			[
				'![Before: toast entrance](.context/before.mp4)',
				'![After: toast entrance](.context/after.mp4#t=0.45)',
				'',
				'- Changed: the toast enters in 220 ms with ease-out.',
				'',
				'Outcome: The toast feels snappier.',
				'Needs: nothing',
			].join('\n'),
			['before.mp4', 'after.mp4'],
		);
		const player = page.getByTestId('report-video-compare');
		await expect(player).toBeVisible({ timeout: 30_000 });
		const marked = player.getByRole('button', { name: 'Jump to the marked moment' });
		await expect(marked).toContainText('f27', { timeout: 20_000 });
		await player.getByRole('button', { name: 'Next frame' }).click();
		await expect(marked).toContainText('f28');
		await marked.click();
		await expect(marked).toContainText('f27');
		const playhead = player.getByRole('slider', { name: 'Scrub both recordings' });
		await playhead.fill('1.2');
		await expect(marked).toContainText('f72');
		const speed = player.getByRole('button', { name: /^Playback speed/u });
		await expect(speed).toHaveText('1×');
		await speed.click();
		await expect(speed).toHaveText('0.5×');
		await captureFlow(app, 'report-motion-compare');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the user picks a variant with a reason, sees the pick in the chat, and the next result carries the decision', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await seedReport(
			page,
			app.root,
			'report-variants',
			[
				'![Variant A: Calm - serif headline, lots of air](.context/variant-a.png)',
				'![Variant B: Bold - dark, high contrast](.context/variant-b.png)',
				'![Variant C: Playful - warm and loud](.context/variant-c.png)',
				'',
				'Outcome: Three directions for the pricing hero.',
				'Needs: Pick a direction',
			].join('\n'),
			['variant-a.png', 'variant-b.png', 'variant-c.png'],
		);
		const cards = page.getByRole('article', { name: 'Turn result' });
		const offer = cards.first();
		const variants = offer.getByRole('radiogroup', { name: 'Variants' });
		await expect(variants.getByRole('radio')).toHaveCount(3, { timeout: 30_000 });
		await expect(offer.getByText('Pick a direction')).toBeVisible();
		await variants.getByRole('radio', { name: /^Variant B · Bold/u }).click();
		await offer.getByRole('textbox', { name: 'Why this variant' }).fill('darker reads better');
		await captureFlow(app, 'report-variants-offer');
		await offer.getByRole('button', { name: 'Go with B' }).click();

		const pick = page.getByTestId('chat-prompt-pick');
		await expect(pick).toContainText('Go with B · Bold', { timeout: 30_000 });
		await expect(pick).toContainText('darker reads better');
		await expect(cards).toHaveCount(2, { timeout: 30_000 });
		await expect(cards.last().getByTestId('turn-report-outcome')).toHaveText('Variant B is built.');
		await expect(cards.last().getByTestId('turn-pick-step')).toContainText(
			'You picked B · Bold over A, C',
		);
		await expect(cards.last().getByTestId('turn-pick-step')).toContainText('darker reads better');
		await expect(offer.getByRole('img', { name: 'Picked' })).toBeVisible();
		await expect(offer.getByText('Your turn')).toHaveCount(0);
		await captureFlow(app, 'report-variants-decision');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a next step sends itself as the next prompt, or lands in the scratchpad', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await seedReport(
			page,
			app.root,
			'report-next',
			[
				'- Changed: the dark mode toggle lives in Settings.',
				'- Next: Refresh the screenshot on the Appearance docs page',
				'- Next: Add the toggle to the onboarding tour',
				'',
				'Outcome: The dark mode toggle lives in Settings.',
				'Needs: nothing',
			].join('\n'),
			[],
		);
		const card = page.getByRole('article', { name: 'Turn result' });
		const steps = card.getByRole('region', { name: 'Next steps' });
		await expect(steps).toBeVisible({ timeout: 30_000 });
		await expect(card.getByRole('img', { name: 'Done' })).toBeVisible();
		await captureFlow(app, 'report-next-steps');

		await steps.getByRole('button', { name: 'Scratchpad' }).last().click();
		await expect(steps).toContainText('In the scratchpad');
		await expect(page.getByText('Added to the scratchpad')).toBeVisible();
		const repository = page
			.getByRole('navigation', { name: 'Connected repositories' })
			.getByRole('link', { name: 'Open report-next' });
		await expect(repository).toHaveAccessibleDescription('1 idea in the scratchpad');

		await steps.getByRole('button', { name: 'Do it now' }).first().click();
		await expect(steps).toContainText('Sent');
		await expect(
			page
				.getByTestId('chat-message-bubble-user')
				.filter({ hasText: 'Refresh the screenshot on the Appearance docs page' }),
		).toBeVisible({ timeout: 30_000 });
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
