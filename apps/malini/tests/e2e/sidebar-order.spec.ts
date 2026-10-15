import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

function sidebar(page: Page) {
	return page.getByRole('navigation', { name: 'Connected repositories' });
}

function workstreamRow(page: Page, workstreamId: string) {
	return sidebar(page).locator(
		`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`,
	);
}

function repositoryHeader(page: Page, fullName: string) {
	return sidebar(page).locator(
		`[data-testid="sidebar-connected-repository"][data-full-name="${fullName}"]`,
	);
}

async function listedWorkstreams(page: Page): Promise<(string | null)[]> {
	return sidebar(page)
		.getByTestId('sidebar-workstream')
		.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-workstream-id')));
}

async function listedRepositories(page: Page): Promise<(string | null)[]> {
	return sidebar(page)
		.getByTestId('sidebar-connected-repository')
		.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-full-name')));
}

test('sidebar order and collapsed repositories survive a relaunch', async () => {
	test.setTimeout(180_000);
	const first = await launchMalini();
	let repositories: (string | null)[] = [];
	try {
		const { page } = first;
		const alpha = await createSourceRepo(first.root, 'alpha');
		const beta = await createSourceRepo(first.root, 'beta');
		await seedWorkstream(page, alpha, 'e2e-order-a1', 'Alpha one');
		await seedWorkstream(page, alpha, 'e2e-order-a2', 'Alpha two');
		await seedWorkstream(page, beta, 'e2e-order-b1', 'Beta one');
		await openWorkstream(page, 'e2e-order-a1');

		await expect(sidebar(page).getByTestId('sidebar-connected-repository')).toHaveCount(2);
		await expect
			.poll(() => listedWorkstreams(page))
			.toEqual(['e2e-order-b1', 'e2e-order-a2', 'e2e-order-a1']);
		const [top, bottom] = await listedRepositories(page);
		if (!top || !bottom) throw new Error('expected two repositories in the sidebar');

		await workstreamRow(page, 'e2e-order-a1').dragTo(workstreamRow(page, 'e2e-order-a2'), {
			targetPosition: { x: 40, y: 4 },
		});
		await expect
			.poll(() => listedWorkstreams(page))
			.toEqual(['e2e-order-b1', 'e2e-order-a1', 'e2e-order-a2']);

		await repositoryHeader(page, bottom).dragTo(repositoryHeader(page, top), {
			targetPosition: { x: 40, y: 4 },
		});
		await expect.poll(() => listedRepositories(page)).toEqual([bottom, top]);
		repositories = [bottom, top];

		const grabbed = await workstreamRow(page, 'e2e-order-a2').boundingBox();
		if (!grabbed) throw new Error('expected the workstream row on screen');
		await page.mouse.move(grabbed.x + 40, grabbed.y + grabbed.height / 2);
		await page.mouse.down();
		await page.mouse.move(grabbed.x + 40, grabbed.y - 40, { steps: 8 });
		await page.keyboard.press('Escape');
		await page.mouse.up();
		await expect
			.poll(() => listedWorkstreams(page))
			.toEqual(['e2e-order-a1', 'e2e-order-a2', 'e2e-order-b1']);
		await expect(page).not.toHaveURL(/e2e-order-a2/u);

		await repositoryHeader(page, top).hover();
		await sidebar(page)
			.getByRole('button', { name: `Collapse ${top}` })
			.click();
		await expect(workstreamRow(page, 'e2e-order-b1')).toBeHidden();
		expectCleanConsole(first);
		await first.quit();
	} catch (error) {
		await first.close();
		throw error;
	}

	const app = await launchMalini({ profile: first.root });
	try {
		const { page } = app;
		const [, collapsed] = repositories;
		await expect(sidebar(page).getByTestId('sidebar-connected-repository')).toHaveCount(2, {
			timeout: 20_000,
		});
		await expect.poll(() => listedRepositories(page)).toEqual(repositories);
		await expect
			.poll(() => listedWorkstreams(page))
			.toEqual(['e2e-order-a1', 'e2e-order-a2', 'e2e-order-b1']);
		await expect(
			sidebar(page).getByRole('button', { name: `Expand ${collapsed}` }),
		).toHaveAttribute('aria-expanded', 'false');
		await expect(workstreamRow(page, 'e2e-order-b1')).toBeHidden();
		await expect(workstreamRow(page, 'e2e-order-a1')).toBeVisible();

		await workstreamRow(page, 'e2e-order-a1').focus();
		await page.keyboard.press('Alt+ArrowDown');
		await expect
			.poll(() => listedWorkstreams(page))
			.toEqual(['e2e-order-a2', 'e2e-order-a1', 'e2e-order-b1']);
		await expect(workstreamRow(page, 'e2e-order-a1')).toBeFocused();

		await captureFlow(app, 'sidebar-order');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
