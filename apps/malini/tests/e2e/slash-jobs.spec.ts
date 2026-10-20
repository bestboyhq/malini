import { expect, test } from '@playwright/test';
import {
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

test('a typed slash opens the job list while the prompt keeps the text, the focus and the query', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-slash-jobs-ws',
			'Slash jobs workstream',
		);
		await openWorkstream(page, workstreamId);
		const input = page.locator('[data-testid="chat-composer-input"][aria-disabled="false"]');
		await expect(input).toBeVisible({ timeout: 20_000 });
		const picker = page.getByTestId('job-picker');
		const jobs = page.getByRole('listbox', { name: 'Jobs' });

		await input.click();
		await page.keyboard.type('Then /', { delay: 10 });
		await expect(jobs).toBeVisible();
		await expect(jobs).toBeInViewport();
		await expect(input).toBeFocused();
		await expect(page.getByRole('textbox', { name: 'Find a job' })).toHaveCount(0);

		await page.keyboard.type('main', { delay: 10 });
		await expect(input).toHaveText('Then /main');
		await expect(jobs.getByRole('option')).toHaveCount(1);
		const selected = jobs.getByRole('option', { name: /^Update from main/u, selected: true });
		await expect(selected).toBeVisible();
		await expect(input).toHaveAttribute(
			'aria-activedescendant',
			(await selected.getAttribute('id')) ?? '',
		);

		await page.keyboard.press('Escape');
		await expect(picker).toBeHidden();
		await expect(input).toBeFocused();
		await expect(input).toHaveText('Then /main');
		await expect(input).not.toHaveAttribute('aria-activedescendant');

		await page.keyboard.type(' /zz', { delay: 10 });
		await expect(picker.getByRole('status')).toHaveText('No job matches “zz”');
		await page.keyboard.press('Space');
		await expect(picker).toBeHidden();
		await expect(input).toBeFocused();

		await page.keyboard.type('/', { delay: 10 });
		await expect(jobs).toBeVisible();
		await page.keyboard.press('Backspace');
		await expect(picker).toBeHidden();
		await expect(input).toHaveText('Then /main /zz');

		await page.getByRole('button', { name: 'Add to prompt' }).click();
		await page.getByRole('menuitem', { name: 'Run a job' }).click();
		await expect(page.getByRole('dialog', { name: 'Run a job' })).toBeVisible();
		await expect(page.getByRole('searchbox', { name: 'Find a job' })).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(picker).toBeHidden();
		await expect(input).toBeFocused();

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
