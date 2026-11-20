import { rmSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	holdCheckouts,
	launchMalini,
	seedWorkstream,
} from './harness';

const OUTCOME = 'Billing page is live';
const COPY = 'Pricing copy is written';
const CHECKOUT = 'Checkout takes a card';

function dayLabel(date: Date): string {
	const weekday = date.toLocaleString('en-US', { weekday: 'short' });
	return `${weekday} ${date.getDate()} ${date.toLocaleString('en-US', { month: 'short' })}`;
}

test('an initiative keeps its dependencies, starts a workstream for one and moves to another day', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const alpha = await createSourceRepo(app.root, 'alpha');
		await seedWorkstream(page, alpha, 'e2e-initiatives-alpha', 'Alpha work');
		await page.reload();

		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		const link = sidebar.getByRole('link', { name: 'Initiatives' });
		await link.click({ timeout: 20_000 });
		await expect(link).toHaveAttribute('aria-current', 'page');
		await expect(page).toHaveTitle('Malini · Initiatives');

		const today = new Date();
		const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
		const initiatives = page.getByRole('region', { name: 'Initiatives' });
		const outcome = initiatives.getByRole('button', { name: OUTCOME, exact: true });
		await initiatives
			.getByRole('textbox', { name: `Name an outcome on ${dayLabel(today)}` })
			.fill(OUTCOME);
		await page.keyboard.press('Enter');
		const dependency = initiatives.getByRole('textbox', { name: `Add a dependency to ${OUTCOME}` });
		await expect(dependency).toBeFocused();
		await page.keyboard.type(COPY);
		await page.keyboard.press('Enter');
		await expect(initiatives.getByRole('checkbox', { name: COPY })).toBeVisible();
		await page.keyboard.type(CHECKOUT);
		await page.keyboard.press('Enter');
		await expect(outcome).toContainText('0 of 2');

		const copy = initiatives.getByRole('checkbox', { name: COPY });
		await copy.click();
		await expect(copy).toBeChecked();
		await expect(outcome).toContainText('1 of 2');

		await page.reload();
		await expect(outcome).toContainText('1 of 2', { timeout: 20_000 });
		await expect(outcome).toHaveAttribute('aria-expanded', 'false');
		await outcome.click();
		await expect(copy).toBeChecked();
		await expect(initiatives.getByRole('checkbox', { name: CHECKOUT })).not.toBeChecked();

		const workstreams = sidebar.getByTestId('sidebar-workstream');
		await expect(workstreams).toHaveCount(1);
		const held = holdCheckouts(app);
		await initiatives.getByRole('button', { name: 'Start workstream' }).click();
		await expect(workstreams).toHaveCount(2);
		await expect(
			workstreams.getByRole('status', { name: 'Workstream status: Creating' }),
		).toHaveCount(1);
		await expect(initiatives.getByRole('img', { name: 'Working' })).toHaveCount(2);
		await expect(initiatives.getByRole('img', { name: 'Failed' })).toHaveCount(0);
		rmSync(held);
		await expect(initiatives.getByRole('button', { name: 'Start workstream' })).toHaveCount(0);
		await expect(initiatives.getByRole('checkbox', { name: CHECKOUT })).toHaveCount(0);
		await expect(initiatives.getByRole('link').filter({ hasText: 'alpha' })).toBeVisible({
			timeout: 30_000,
		});
		await expect(outcome).toContainText('1 of 2');
		await captureFlow(app, 'initiatives-started');

		await outcome.focus();
		await page.keyboard.press('Alt+ArrowDown');
		const nextDay = initiatives.getByRole('group', { name: dayLabel(tomorrow), exact: true });
		await expect(nextDay.getByRole('button', { name: OUTCOME, exact: true })).toBeVisible();
		await expect(nextDay.getByRole('button', { name: OUTCOME, exact: true })).toBeFocused();
		await page.reload();
		await expect(nextDay.getByRole('button', { name: OUTCOME, exact: true })).toBeVisible({
			timeout: 20_000,
		});
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
