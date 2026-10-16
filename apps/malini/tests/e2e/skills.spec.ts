import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

test('setup offers presets Claude suggests, groups skills by dragging, and walks on to the first repository', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const setup = page.getByTestId('onboarding');
		await expect(setup.getByRole('heading', { name: 'Connect Claude Code' })).toBeVisible();
		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(
			setup.getByRole('heading', { name: 'Group your skills into presets' }),
		).toBeVisible();
		await expect(setup).toContainText('Right now every chat loads all 7 skills');
		await expect(setup.getByText('Suggested by Claude from your skills')).toBeVisible();
		await expect(page.getByTestId('global-topbar-sidebar-toggle')).toHaveCount(0);
		await captureFlow(app, 'skills-setup-suggestions');

		await setup.getByRole('button', { name: 'Add the Writer preset' }).click();
		const writer = preset(page, 'Writer');
		await expect(writer.getByTestId('skill-preset-skill')).toHaveText([
			/humanizer/u,
			/landing-arch/u,
		]);
		await expect(writer.getByTestId('skill-preset-default')).toBeVisible();
		await expect(writer.getByRole('button', { name: 'Emoji for Writer' })).toHaveText('✍️');

		await dragSkill(page, 'animate', page.getByTestId('skill-preset-suggestion'));
		const builder = preset(page, 'Builder');
		await expect(builder.getByTestId('skill-preset-skill')).toHaveText([
			/adr/u,
			/test-malini-app/u,
			/ponytail/u,
			/animate/u,
		]);
		await expect(page.getByTestId('skill-preset-suggestion')).toHaveCount(0);

		await page.getByRole('button', { name: 'dataviz. Add to a preset' }).click();
		await page.getByRole('menuitem', { name: 'New preset with this skill' }).click();
		await page.getByRole('textbox', { name: 'Preset name' }).fill('Analyst');
		await page.getByRole('textbox', { name: 'Preset name' }).press('Enter');
		await expect(preset(page, 'Analyst')).toContainText('dataviz');
		const analystEmoji = page.getByRole('button', { name: 'Emoji for Analyst' });
		await expect(analystEmoji).toHaveText('A');
		await analystEmoji.click();
		await page
			.getByRole('dialog', { name: 'Emoji for Analyst' })
			.getByRole('button', { name: '📊' })
			.click();
		await expect(analystEmoji).toHaveText('📊');
		await expect(page.getByRole('button', { name: 'dataviz. Add to a preset' })).toContainText(
			'📊',
		);

		await builder.getByRole('button', { name: 'Emoji for Builder' }).click();
		await page
			.getByRole('dialog', { name: 'Emoji for Builder' })
			.getByRole('textbox', { name: 'Type any emoji' })
			.fill('unicorn 🦄');
		await expect(builder.getByRole('button', { name: 'Emoji for Builder' })).toHaveText('🦄');
		await captureFlow(app, 'skills-setup-presets');

		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Meet your jobs' })).toBeVisible();
		await expect(setup.getByRole('link', { name: /^Suggest skill presets/u })).toContainText(
			'Built-in',
		);
		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Open your first repository' })).toBeVisible();
		await setup.getByRole('button', { name: 'Skip for now' }).click();
		await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible();
		await expect(page.getByTestId('onboarding')).toHaveCount(0);
		await expect(page.getByTestId('global-topbar-sidebar-toggle')).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a chat hands its agent only the skills of its preset, and every skill otherwise', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-skills-ws', 'Skills');
		await openWorkstream(page, workstreamId);

		const skills = page.getByTestId('chat-skills');
		await expect(skills).toHaveAccessibleName('Skills: All skills · 7 skills');
		await sendPrompt(page, 'WHICH_SKILLS');
		await expect(page.getByText('Skills: all')).toBeVisible({ timeout: 30_000 });

		await skills.click();
		await page.getByRole('menuitemcheckbox', { name: /^dataviz/u }).click();
		await expect(skills).toHaveAccessibleName('Skills: Custom · 6 skills');
		await page.keyboard.press('Escape');
		await sendPrompt(page, 'WHICH_SKILLS again');
		await expect(
			page.getByText(
				'Skills: animate, humanizer, landing-arch, adr, test-malini-app, ponytail:ponytail',
			),
		).toBeVisible({
			timeout: 30_000,
		});

		await skills.click();
		await page.getByRole('menuitem', { name: 'Edit presets…' }).click();
		const settings = page.getByRole('dialog', { name: 'Settings' });
		await expect(settings.getByRole('heading', { name: 'Skills', exact: true })).toBeVisible();
		await settings.getByRole('button', { name: 'humanizer. Add to a preset' }).click();
		await page.getByRole('menuitem', { name: 'New preset with this skill' }).click();
		await page.getByRole('textbox', { name: 'Preset name' }).fill('Writer');
		await page.getByRole('textbox', { name: 'Preset name' }).press('Enter');
		await expect(preset(page, 'Writer')).toContainText('humanizer');
		await captureFlow(app, 'skills-settings');
		await page.keyboard.press('Escape');

		await skills.click();
		await page.getByRole('menuitemradio', { name: /Writer/u }).click();
		await expect(skills).toHaveAccessibleName('Skills: Writer · 1 skill');
		await captureFlow(app, 'skills-composer-menu');
		await page.keyboard.press('Escape');
		await sendPrompt(page, 'WHICH_SKILLS once more');
		await expect(page.getByText('Skills: humanizer', { exact: true })).toBeVisible({
			timeout: 30_000,
		});
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

function preset(page: Page, name: string) {
	return page.locator(`[data-testid="skill-preset"][data-preset="${name}"]`);
}

async function dragSkill(
	page: Page,
	skill: string,
	target: ReturnType<Page['locator']>,
): Promise<void> {
	const row = page.locator(`[data-testid="skill-row"][data-skill="${skill}"]`);
	await row.scrollIntoViewIfNeeded();
	const from = await row.boundingBox();
	const to = await target.boundingBox();
	if (!from || !to) throw new Error(`cannot drag ${skill}: nothing is laid out`);
	await page.mouse.move(from.x + 24, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(from.x + 48, from.y + from.height / 2 + 8, { steps: 4 });
	await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
	await page.mouse.up();
}
