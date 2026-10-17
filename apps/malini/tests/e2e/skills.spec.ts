import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('setup goes from accounts straight to jobs, with no skills to sort', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const setup = page.getByTestId('onboarding');
		await expect(setup.getByRole('heading', { name: 'Connect Claude Code' })).toBeVisible();
		await expect(setup.getByText('Step 1 of 3')).toBeVisible();
		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Meet your jobs' })).toBeVisible();
		await expect(setup.getByRole('link', { name: /^Suggest skill presets/u })).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Settings ranks skills by use and turns a skill and a plugin off in Claude Code settings', async () => {
	test.setTimeout(120_000);
	const root = mkdtempSync(join(tmpdir(), 'malini-e2e-'));
	const home = join(root, 'home');
	const settingsFile = join(home, '.claude', 'settings.json');
	mkdirSync(join(home, '.claude'), { recursive: true });
	writeFileSync(
		join(home, '.claude.json'),
		JSON.stringify({
			firstStartTime: '2026-06-30T10:35:42.832Z',
			skillUsage: {
				adr: { usageCount: 25, lastUsedAt: Date.now() - 86_400_000 },
				'ponytail:ponytail': { usageCount: 3, lastUsedAt: Date.now() - 10 * 86_400_000 },
				animate: { usageCount: 1, lastUsedAt: Date.now() - 90 * 86_400_000 },
			},
		}),
	);
	writeFileSync(
		settingsFile,
		JSON.stringify({ theme: 'dark', enabledPlugins: { 'ponytail@ponytail': true } }, null, 2),
	);
	const app = await launchMalini({ profile: root });
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-skills-ws', 'Skills');
		await openWorkstream(page, workstreamId);
		await expect(page.getByTestId('chat-skills')).toHaveCount(0);
		await sendPrompt(page, 'WHICH_SKILLS');
		await expect(page.getByText('Skills: all')).toBeVisible({ timeout: 30_000 });

		await page.getByTestId('sidebar-open-settings').click();
		await page
			.getByRole('navigation', { name: 'Settings' })
			.getByRole('link', { name: 'Skills' })
			.click();
		const ranked = page.getByRole('list', { name: 'Skills by use' });
		await expect(ranked.getByRole('heading', { level: 4 })).toHaveText([
			'adr',
			'ponytail',
			'animate',
			'dataviz',
			'landing-arch',
			'humanizer',
			'test-malini-app',
		]);
		await expect(row(page, 'adr')).toContainText('25 uses');
		await expect(row(page, 'ponytail')).toContainText('Plugin · ponytail');
		await expect(page.getByTestId('skill-usage-unused')).toContainText(
			'4 of the skills you keep on were never used',
		);
		await captureFlow(app, 'skills-usage');

		await page.getByRole('switch', { name: 'Skill dataviz' }).click();
		await expect(page.getByRole('switch', { name: 'Skill dataviz' })).toHaveAttribute(
			'aria-checked',
			'false',
		);
		await page.getByRole('switch', { name: 'Plugin ponytail' }).click();
		await expect(page.getByRole('switch', { name: 'Plugin ponytail' })).toHaveAttribute(
			'aria-checked',
			'false',
		);
		await expect
			.poll(() => JSON.parse(readFileSync(settingsFile, 'utf8')))
			.toEqual({
				theme: 'dark',
				enabledPlugins: { 'ponytail@ponytail': false },
				skillOverrides: { dataviz: 'off' },
			});
		await expect(page.getByTestId('skill-usage-totals')).toContainText('5 on');
		await captureFlow(app, 'skills-usage-off');

		await page.getByRole('switch', { name: 'Skill dataviz' }).click();
		await expect
			.poll(() => JSON.parse(readFileSync(settingsFile, 'utf8')))
			.toEqual({ theme: 'dark', enabledPlugins: { 'ponytail@ponytail': false } });
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Settings → Jobs keeps skill presets for jobs, built by menu and by dragging', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-presets-ws', 'Presets');
		await openWorkstream(page, workstreamId);

		await page.getByTestId('sidebar-open-settings').click();
		await page
			.getByRole('navigation', { name: 'Settings' })
			.getByRole('link', { name: 'Jobs' })
			.click();
		const presets = page.getByRole('region', { name: 'Skill presets' });
		await presets.getByRole('button', { name: 'dataviz. Add to a preset' }).click();
		await page.getByRole('menuitem', { name: 'New preset with this skill' }).click();
		await page.getByRole('textbox', { name: 'Preset name' }).fill('Analyst');
		await page.getByRole('textbox', { name: 'Preset name' }).press('Enter');
		const analyst = preset(page, 'Analyst');
		await expect(analyst).toContainText('dataviz');
		await page.getByRole('button', { name: 'Emoji for Analyst' }).click();
		await page
			.getByRole('dialog', { name: 'Emoji for Analyst' })
			.getByRole('button', { name: '📊' })
			.click();
		await expect(page.getByRole('button', { name: 'Emoji for Analyst' })).toHaveText('📊');

		await dragSkill(page, 'adr', analyst);
		await expect(analyst.getByTestId('skill-preset-skill')).toHaveText([/dataviz/u, /adr/u]);
		await captureFlow(app, 'skills-job-presets');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

function row(page: Page, name: string) {
	return page
		.getByRole('list', { name: 'Skills by use' })
		.getByRole('listitem')
		.filter({ has: page.getByRole('heading', { name, exact: true }) });
}

function preset(page: Page, name: string) {
	return page.locator(`[data-testid="skill-preset"][data-preset="${name}"]`);
}

async function dragSkill(
	page: Page,
	skill: string,
	target: ReturnType<Page['locator']>,
): Promise<void> {
	const source = page.locator(`[data-testid="skill-row"][data-skill="${skill}"]`);
	await source.scrollIntoViewIfNeeded();
	const from = await source.boundingBox();
	const to = await target.boundingBox();
	if (!from || !to) throw new Error(`cannot drag ${skill}: nothing is laid out`);
	await page.mouse.move(from.x + 24, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(from.x + 48, from.y + from.height / 2 + 8, { steps: 4 });
	await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
	await page.mouse.up();
}
