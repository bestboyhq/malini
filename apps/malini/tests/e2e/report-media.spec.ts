import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	APP_ROOT,
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectCleanConsole,
	launchMalini,
	listEvents,
	listSessions,
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
): Promise<string> {
	const source = await createSourceRepo(root, name);
	const seeded = await seedWorkstream(page, source, `e2e-${name}`, name);
	mkdirSync(join(seeded.worktree, '.context'), { recursive: true });
	for (const file of media)
		copyFileSync(join(MEDIA, file), join(seeded.worktree, '.context', file));
	writeFileSync(join(seeded.worktree, 'report.md'), report);
	await openWorkstream(page, seeded.workstreamId);
	await sendPrompt(page, 'Show me REPLY_FILE:report.md');
	return seeded.workstreamId;
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

		await compare.getByRole('button', { name: 'Open in gallery' }).click();
		const gallery = page.getByRole('dialog', { name: 'Image gallery' });
		await gallery.getByRole('img', { name: 'After: pricing page' }).click();
		await expect(gallery).toBeHidden();
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
		const variants = offer.getByRole('tablist', { name: 'Report media' });
		await expect(variants.getByRole('tab')).toHaveCount(3, { timeout: 30_000 });
		await expect(offer.getByText('Pick a direction')).toBeVisible();
		await variants.getByRole('tab', { name: /^Variant B · Bold/u }).click();
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

		const gallery = page.getByRole('dialog', { name: 'Image gallery' });
		await offer.getByRole('button', { name: 'Open image Variant B · Bold in gallery' }).click();
		await gallery.getByRole('img', { name: 'Variant B: Bold - dark, high contrast' }).click();
		await expect(gallery).toBeHidden();

		const pickStep = cards.last().getByTestId('turn-pick-step');
		await pickStep.getByText('You picked').click();
		await pickStep
			.getByRole('button', { name: 'Open image Variant C · Playful in gallery' })
			.click();
		await gallery.getByRole('img', { name: 'Variant C: Playful - warm and loud' }).click();
		await expect(gallery).toBeHidden();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('variants and the before and after share one frame, and the evidence keeps the chosen variant', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await seedReport(
			page,
			app.root,
			'report-variants-evidence',
			[
				'![Variant A: Calm - serif headline, lots of air](.context/variant-a.png)',
				'![Variant B: Bold - dark, high contrast](.context/variant-b.png)',
				'![Variant C: Playful - warm and loud](.context/variant-c.png)',
				'![Before: pricing page](.context/before.png)',
				'![After: pricing page](.context/after.png)',
				'',
				'- Changed: the Pro button is solid and says Start free trial.',
				'',
				'Outcome: Three directions for the pricing hero.',
				'Needs: Pick a direction',
			].join('\n'),
			['variant-a.png', 'variant-b.png', 'variant-c.png', 'before.png', 'after.png'],
		);
		const card = page.getByRole('article', { name: 'Turn result' });
		const media = card.getByRole('tablist', { name: 'Report media' });
		await expect(media.getByRole('tab')).toHaveCount(4, { timeout: 30_000 });
		await expect(card.getByTestId('report-stage')).toHaveCount(1);
		const compare = card.getByRole('group', { name: 'Before and after' });
		await expect(compare).toBeHidden();

		await media.getByRole('tab', { name: /^Variant B · Bold/u }).click();
		const evidence = media.getByRole('tab', { name: 'Before and after' });
		await evidence.click();
		await expect(evidence).toHaveAttribute('aria-selected', 'true');
		await expect(compare).toBeVisible();
		await expect(
			card.getByRole('button', { name: 'Open image Variant B · Bold in gallery' }),
		).toBeHidden();
		await expect(card.getByRole('button', { name: 'Go with B' })).toBeVisible();
		await untilStill(page);
		await captureFlow(app, 'report-variants-evidence');

		await page.keyboard.press('ArrowLeft');
		const playful = media.getByRole('tab', { name: /^Variant C · Playful/u });
		await expect(playful).toBeFocused();
		await expect(playful).toHaveAttribute('aria-selected', 'true');
		await expect(compare).toBeHidden();
		await expect(card.getByRole('button', { name: 'Go with C' })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('variants preview as pictures, looping recordings and live HTML pages', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await seedReport(
			page,
			app.root,
			'report-live-variants',
			[
				'![Variant A: Still - one screenshot](.context/variant-a.png)',
				'![Variant B: Motion - the toast entrance](.context/after.mp4)',
				'![Variant C: Live - the page itself](.context/variant-live.html)',
				'',
				'Outcome: Three ways to show the pricing hero.',
				'Needs: Pick a direction',
			].join('\n'),
			['variant-a.png', 'after.mp4', 'variant-live.html', 'variant-live.css'],
		);
		const offer = page.getByRole('article', { name: 'Turn result' }).first();
		const variants = offer.getByRole('tablist', { name: 'Report media' });
		await expect(variants.getByRole('tab')).toHaveCount(3, { timeout: 30_000 });

		await variants.getByRole('tab', { name: /^Variant B · Motion/u }).click();
		const recording = offer.getByLabel('Variant B · Motion', { exact: true });
		await expect
			.poll(() => recording.evaluate((video) => Number(Reflect.get(video, 'currentTime'))), {
				timeout: 20_000,
			})
			.toBeGreaterThan(0);
		await offer.getByRole('button', { name: 'Open video Variant B · Motion in gallery' }).click();
		const gallery = page.getByRole('dialog', { name: 'Image gallery' });
		await expect(
			gallery.getByLabel('Variant B: Motion - the toast entrance', { exact: true }),
		).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(gallery).toBeHidden();

		await variants.getByRole('tab', { name: /^Variant C · Live/u }).click();
		const live = offer.locator('iframe[title="Variant C · Live"]:not([inert])').contentFrame();
		await expect(live.getByRole('heading', { name: 'Pricing that moves' })).toBeVisible({
			timeout: 20_000,
		});
		await expect
			.poll(() =>
				live
					.locator('.pulse')
					.evaluate(
						(pulse) => pulse.ownerDocument.defaultView?.getComputedStyle(pulse).animationName,
					),
			)
			.toBe('pulse');
		await expect(offer.getByRole('button', { name: /Variant C · Live in gallery/u })).toHaveCount(
			0,
		);
		await captureFlow(app, 'report-live-variants');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a report puts every picture in one frame, and a lone prototype there shows as its live page', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await seedReport(
			page,
			app.root,
			'report-lone-page',
			[
				'![Before: pricing page](.context/before.png)',
				'![After: pricing page](.context/after.png)',
				'![Variant A: Live - the page itself](.context/variant-live.html)',
				'',
				'- Changed: the Pro button is solid.',
				'',
				'Outcome: The pricing hero has a live prototype.',
				'Needs: your go-ahead to build the hero from this prototype',
			].join('\n'),
			['before.png', 'after.png', 'variant-live.html', 'variant-live.css'],
		);
		const card = page.getByRole('article', { name: 'Turn result' });
		const media = card.getByRole('tablist', { name: 'Report media' });
		await expect(media.getByRole('tab')).toHaveCount(2, { timeout: 30_000 });
		await expect(media.getByRole('tab', { name: 'Before and after' })).toHaveAttribute(
			'aria-selected',
			'true',
		);
		await expect(card.getByRole('group', { name: 'Before and after' })).toBeVisible();
		await media.getByRole('tab', { name: 'Live - the page itself' }).click();
		await expect(card.getByRole('group', { name: 'Before and after' })).toBeHidden();
		const live = card.locator('iframe[title="Live - the page itself"]:not([inert])').contentFrame();
		await expect(live.getByRole('heading', { name: 'Pricing that moves' })).toBeVisible({
			timeout: 20_000,
		});
		await expect(card.getByRole('img', { name: /Variant A/u })).toHaveCount(0);
		await untilStill(page);
		await captureFlow(app, 'report-lone-page');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a next step ships as the next prompt, ships in a forked chat with ⌘, or is noted', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const workstreamId = await seedReport(
			page,
			app.root,
			'report-next',
			[
				'- Changed: the dark mode toggle lives in Settings.',
				'- Next: Refresh the screenshot on the Appearance docs page',
				'- Next: Add the toggle to the onboarding tour',
				'- Next: Mention the toggle in the changelog',
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
		await expect(steps.getByRole('button', { name: 'Ship', exact: true })).toHaveCount(3);
		await captureFlow(app, 'report-next-steps');
		const parent = currentSessionId(page);
		if (!parent) throw new Error('the report chat did not commit a session id');

		await page.keyboard.down('Meta');
		const forks = steps.getByRole('button', { name: 'Slice, fork, ship' });
		await expect(forks).toHaveCount(3);
		await captureFlow(app, 'report-next-steps-command');
		await forks.last().click({ modifiers: ['Meta'] });
		await page.keyboard.up('Meta');
		await expect(steps).toContainText('Shipped in a new chat');
		await expect(steps.getByRole('button', { name: 'Ship', exact: true })).toHaveCount(2);
		expect(currentSessionId(page)).toBe(parent);
		const forkedPrompt = async (): Promise<Record<string, unknown> | null> => {
			for (const session of await listSessions(page, workstreamId)) {
				if (session.id === parent) continue;
				const prompt = (await listEvents(page, session.id)).find(
					(entry) => entry.event.type === 'user.message',
				)?.event;
				if (prompt) return prompt;
			}
			return null;
		};
		await expect.poll(forkedPrompt, { timeout: 30_000 }).toEqual(
			expect.objectContaining({
				text: expect.stringContaining('Mention the toggle in the changelog'),
				attachments: [
					expect.objectContaining({ displayName: expect.stringMatching(/^Transcript of /u) }),
				],
			}),
		);

		await steps.getByRole('button', { name: 'Note it' }).last().click();
		await expect(steps).toContainText('In the scratchpad');
		await expect(page.getByText('Added to the scratchpad')).toBeVisible();
		const repository = page
			.getByRole('navigation', { name: 'Connected repositories' })
			.getByRole('link', { name: 'Open report-next' });
		await expect(repository).toHaveAccessibleDescription('1 idea in the scratchpad');

		await steps.getByRole('button', { name: 'Ship', exact: true }).first().click();
		await expect(steps).toContainText('Sent');
		await expect(
			page
				.getByTestId('chat-message-bubble-user')
				.filter({ hasText: 'Refresh the screenshot on the Appearance docs page' }),
		).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByTestId('chat-message-bubble').filter({ hasText: 'Hello from the fake bridge' }),
			'the sent step runs to its reply before the app quits',
		).toHaveCount(2, { timeout: 30_000 });
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
