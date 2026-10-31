import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	draftJob,
	expectCleanConsole,
	invoke,
	launchMalini,
	openJob,
	openJobs,
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
		await expect(setup.getByText('Step 1 of 5')).toBeVisible();
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

test('a job names its own skills in the editor, and its agent loads only those', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-job-skills', 'Job skills');
		await openJobs(page);
		await draftJob(page, { name: 'Which skills', words: 'WHICH_SKILLS' });
		const form = (await openJob(page, 'Which skills')).getByRole('form', {
			name: 'Edit Which skills',
		});
		const skills = form.getByRole('combobox', { name: 'Skills' });
		await expect(skills).toHaveAttribute('placeholder', 'Every skill that is on');
		await skills.fill('data');
		await form
			.getByRole('listbox')
			.getByRole('option', { name: /^dataviz/u })
			.click();
		await skills.fill('adr');
		await form.getByRole('listbox').getByRole('option', { name: /^adr/u }).click();
		await skills.press('Escape');
		await expect(form.getByRole('listbox')).toHaveCount(0);
		await expect(form.getByRole('button', { name: /^Remove /u })).toHaveCount(2);
		await expect(form).toContainText("The job's agent loads only these");
		await captureFlow(app, 'skills-job-editor');
		await form.getByRole('button', { name: 'Save changes' }).click();
		await expect
			.poll(
				async () =>
					(
						await invoke<{ name: string; skills: string[] }[]>(
							page,
							'jobs.list-definitions',
							undefined,
						)
					).find(({ name }) => name === 'Which skills')?.skills,
			)
			.toEqual(['dataviz', 'adr']);
		await page.getByRole('button', { name: 'Remove adr' }).click();
		await page.getByRole('button', { name: 'Save changes' }).click();
		await expect
			.poll(
				async () =>
					(
						await invoke<{ name: string; skills: string[] }[]>(
							page,
							'jobs.list-definitions',
							undefined,
						)
					).find(({ name }) => name === 'Which skills')?.skills,
			)
			.toEqual(['dataviz']);

		await openWorkstream(page, workstreamId);
		const input = page.locator('[data-testid="chat-composer-input"][aria-disabled="false"]');
		await input.click();
		await page.keyboard.type('/Which', { delay: 10 });
		await page
			.getByRole('listbox', { name: 'Jobs' })
			.getByRole('option', { name: /^Which skills/u })
			.click();
		const card = page.getByRole('article', { name: 'Job Which skills' });
		await expect(card).toContainText('Done', { timeout: 30_000 });
		await card.getByRole('link', { name: 'Open transcript' }).click();
		await expect(page.getByText('Skills: dataviz', { exact: true })).toBeVisible({
			timeout: 20_000,
		});
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
