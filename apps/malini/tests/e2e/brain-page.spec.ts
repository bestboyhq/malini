import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { BrainStatus } from '../../src/contract/brain';
import { brainOnGithub } from './fake-brain';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	invoke,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

const DAY = 'log/2026-11-02';
const NOTE_TITLE = 'Confine the command to the checkout';

test('the Brain page renders a note, its wiki link jumps to the log day, and the day lists the note that links it', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await brainOnGithub(app, 'missing');
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-brain-page',
			'Sandbox rules',
		);
		await openWorkstream(page, seeded.workstreamId);
		const status = await invoke<BrainStatus>(page, 'brain.set-up', { sync: true });
		expect(status.location).toBeTruthy();
		await page.evaluate(() => {
			location.hash = '#/settings/brain';
		});
		const settings = page.getByRole('dialog', { name: 'Settings' });
		await settings.getByRole('link', { name: 'Open the brain' }).click();
		await expect(settings).toHaveCount(0);
		await expect(page).toHaveTitle('Malini · Brain');
		await expect(page.getByRole('heading', { name: 'Nothing here yet', level: 1 })).toBeVisible({
			timeout: 20_000,
		});
		await expect(page.getByRole('button', { name: 'Write notes now' })).toBeVisible();
		await captureFlow(app, 'brain-page-empty');

		const brain = status.location ?? '';
		mkdirSync(join(brain, 'notes'), { recursive: true });
		mkdirSync(join(brain, 'log'), { recursive: true });
		writeFileSync(
			join(brain, 'notes', 'lessons.md'),
			`# ${NOTE_TITLE}\n\nA chat runs its commands inside its checkout, and outside it only when you say so. It came up on [[${DAY}]].\n`,
		);
		writeFileSync(
			join(brain, `${DAY}.md`),
			'# 2026-11-02\n\n## Sandbox rules - malini\n\n> Can a chat run outside the sandbox?\n\nOutcome: Only when you allow it.\n',
		);
		await page.reload();

		const nav = page.getByRole('navigation', { name: 'Brain' });
		await expect(page.getByRole('heading', { name: NOTE_TITLE, level: 1 })).toBeVisible({
			timeout: 20_000,
		});
		await expect(nav.getByRole('link', { name: 'Lessons' })).toHaveAttribute(
			'aria-current',
			'page',
		);
		await expect(nav.getByRole('link', { name: 'Nov 2, 2026' })).toBeVisible();
		await expect(page.getByRole('status').filter({ hasText: /e2e-user\/brain/u })).toBeVisible();
		const dayLinks = page.getByTestId('brain').getByRole('link', { name: DAY });
		await expect(dayLinks).toHaveCount(2);
		await captureFlow(app, 'brain-page-note');

		await dayLinks.last().click();
		await expect(page.getByRole('heading', { name: 'Nov 2, 2026', level: 1 })).toBeVisible();
		await expect(page.getByText('Append-only. Agents never rewrite this page.')).toBeVisible();
		await expect(nav.getByRole('link', { name: 'Nov 2, 2026' })).toHaveAttribute(
			'aria-current',
			'page',
		);
		const linkedFrom = page.getByRole('region', { name: 'Linked from' });
		await expect(linkedFrom.getByRole('link', { name: NOTE_TITLE })).toBeVisible();
		await captureFlow(app, 'brain-page-log-day');

		await linkedFrom.getByRole('link', { name: NOTE_TITLE }).click();
		await expect(page.getByRole('heading', { name: NOTE_TITLE, level: 1 })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
