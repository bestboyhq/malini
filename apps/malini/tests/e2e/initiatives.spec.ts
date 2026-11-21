import { rmSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	holdCheckouts,
	invoke,
	launchMalini,
	seedWorkstream,
	type WorkstreamRow,
} from './harness';

const OUTCOME = 'Billing page is live';
const COPY = 'Pricing copy is written';
const CHECKOUT = 'Checkout takes a card';
const COPY_RENAMED = 'Pricing copy is approved';
const NOTE = 'Launch with the annual plan first';

function dayLabel(date: Date): string {
	const weekday = date.toLocaleString('en-US', { weekday: 'short' });
	return `${weekday} ${date.getDate()} ${date.toLocaleString('en-US', { month: 'short' })}`;
}

test('an initiative shows only on its repository page, keeps its dependencies and notes, starts a workstream there and moves to another day', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const alpha = await createSourceRepo(app.root, 'alpha');
		const beta = await createSourceRepo(app.root, 'beta');
		await seedWorkstream(page, beta, 'e2e-initiatives-beta', 'Beta work');
		await seedWorkstream(page, alpha, 'e2e-initiatives-alpha', 'Alpha work');
		await page.reload();

		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		const link = sidebar.getByRole('link', { name: 'Open alpha' });
		await link.click({ timeout: 20_000 });
		await expect(link).toHaveAttribute('aria-current', 'page');
		await expect(page).toHaveTitle('Malini · alpha');
		await expect(sidebar.getByRole('link', { name: 'Initiatives' })).toHaveCount(0);

		const today = new Date();
		const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
		const initiatives = page.getByRole('region', { name: 'Initiatives' });
		const outcome = initiatives.getByRole('button', { name: OUTCOME, exact: true });
		const row = initiatives.getByRole('group', { name: OUTCOME, exact: true });
		const fold = initiatives.getByRole('button', { name: `Dependencies of ${OUTCOME}` });
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
		await expect(row).toContainText('0 of 2');

		const copy = initiatives.getByRole('checkbox', { name: COPY });
		await copy.click();
		await expect(copy).toBeChecked();
		await expect(row).toContainText('1 of 2');

		await sidebar.getByRole('link', { name: 'Open beta' }).click();
		await expect(page).toHaveTitle('Malini · beta');
		await expect(
			initiatives.getByRole('textbox', { name: `Name an outcome on ${dayLabel(today)}` }),
		).toBeVisible();
		await expect(outcome).toHaveCount(0);
		await link.click();
		await expect(page).toHaveTitle('Malini · alpha');

		await page.reload();
		await expect(row).toContainText('1 of 2', { timeout: 20_000 });
		await expect(fold).toHaveAttribute('aria-expanded', 'true');
		await expect(copy).toBeChecked();
		await expect(initiatives.getByRole('checkbox', { name: CHECKOUT })).not.toBeChecked();
		await fold.click();
		await expect(fold).toHaveAttribute('aria-expanded', 'false');
		await expect(copy).toHaveCount(0);
		await fold.click();
		await expect(copy).toBeChecked();

		const scratchpad = page.getByRole('textbox', { name: /^Scratchpad for / });
		await expect(scratchpad).toBeVisible();
		await outcome.click();
		await expect(initiatives.getByRole('textbox', { name: `Rename ${OUTCOME}` })).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(outcome).toBeFocused();
		await expect(scratchpad).toHaveCount(0);
		const outcomeNote = page.getByRole('region', { name: `Note on ${OUTCOME}` });
		await outcomeNote.getByRole('textbox', { name: `Note on ${OUTCOME}` }).click();
		await page.keyboard.type(NOTE);
		await expect(row.getByRole('img', { name: 'Has a note' })).toBeVisible();

		await initiatives.getByRole('button', { name: `Rename ${COPY}` }).click();
		await page.keyboard.press('ControlOrMeta+A');
		await page.keyboard.type(COPY_RENAMED);
		await page.keyboard.press('Enter');
		await expect(initiatives.getByRole('checkbox', { name: COPY_RENAMED })).toBeChecked();
		const copyNote = page.getByRole('region', { name: `Note on ${COPY_RENAMED}` });
		await expect(copyNote).toContainText(`Dependency of ${OUTCOME}`);
		await captureFlow(app, 'initiatives-note');
		await copyNote.getByRole('button', { name: OUTCOME }).click();
		await expect(outcomeNote).toContainText(NOTE);
		await outcomeNote.getByRole('button', { name: 'Scratchpad' }).click();
		await expect(scratchpad).toBeVisible();
		expect(
			(await invoke<{ note: string | null }[]>(page, 'initiatives.list', undefined)).map(
				({ note }) => note?.includes(NOTE),
			),
		).toEqual([true]);

		const workstreams = sidebar.getByTestId('sidebar-workstream');
		await expect(workstreams).toHaveCount(2);
		const held = holdCheckouts(app);
		await initiatives.getByRole('button', { name: 'Start workstream' }).click();
		await expect(workstreams).toHaveCount(3);
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
		await expect(row).toContainText('1 of 2');
		await expect
			.poll(async () =>
				(await invoke<WorkstreamRow[]>(page, 'repositories.list-workstreams', undefined))
					.filter(({ id }) => !id.startsWith('e2e-'))
					.map(({ projectId }) => projectId),
			)
			.toEqual(['local__alpha']);
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
