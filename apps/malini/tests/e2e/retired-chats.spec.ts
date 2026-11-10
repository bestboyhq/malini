import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	invoke,
	launchMalini,
	seedWorkstream,
	type LaunchedApp,
} from './harness';

const RETIRED = 'e2e-retired-organization-chat';
const RETIRED_NAME = 'Logdash supervisor';

function statusOf(app: LaunchedApp, workstreamId: string): unknown {
	const db = new DatabaseSync(join(app.userDataDir, 'malini.sqlite'), { readOnly: true });
	try {
		return db.prepare('SELECT status FROM workstreams WHERE id = ?').get(workstreamId)?.['status'];
	} finally {
		db.close();
	}
}

test('an organization chat from an older version is archived at boot and shows nowhere', async () => {
	test.setTimeout(180_000);
	const first = await launchMalini();
	let basePath = '';
	try {
		const source = await createSourceRepo(first.root);
		await seedWorkstream(first.page, source, 'e2e-retired-still-going', 'Still going');
		await seedWorkstream(first.page, source, 'e2e-retired-merged-earlier', 'Merged earlier');
		await invoke(first.page, 'repositories.archive-workstream', {
			workstreamId: 'e2e-retired-merged-earlier',
		});
		({ basePath } = await seedWorkstream(first.page, source, RETIRED, RETIRED_NAME));
		await first.quit();
	} catch (error) {
		await first.close();
		throw error;
	}
	const db = new DatabaseSync(join(first.userDataDir, 'malini.sqlite'));
	db.prepare(
		"INSERT INTO projects (id, name, repo_path, default_branch, created_at) VALUES ('malini-lead-space', 'lead-space', ?, 'main', ?)",
	).run(basePath, new Date().toISOString());
	db.prepare(
		"UPDATE workstreams SET project_id = 'malini-lead-space', scope = 'owner:acme' WHERE id = ?",
	).run(RETIRED);
	db.close();

	const app = await launchMalini({ profile: first.root });
	try {
		const { page } = app;
		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		await expect.poll(() => statusOf(app, RETIRED), { timeout: 30_000 }).toBe('archived');
		await expect(
			sidebar.locator(
				'[data-testid="sidebar-workstream"][data-workstream-id="e2e-retired-still-going"]',
			),
		).toBeVisible({ timeout: 20_000 });
		await expect(sidebar.getByText(RETIRED_NAME)).toHaveCount(0);
		await expect(
			sidebar.locator(`[data-testid="sidebar-workstream"][data-workstream-id="${RETIRED}"]`),
		).toHaveCount(0);

		const archived = page.getByRole('list', { name: 'Recently archived' });
		await expect(
			archived.locator('[data-workstream-id="e2e-retired-merged-earlier"]'),
		).toBeVisible();
		await expect(archived.locator(`[data-workstream-id="${RETIRED}"]`)).toHaveCount(0);
		await expect(archived.getByText(RETIRED_NAME)).toHaveCount(0);

		const active = await invoke<readonly Readonly<{ id: string }>[]>(
			page,
			'repositories.list-workstreams',
		);
		expect(active.map(({ id }) => id)).toEqual(['e2e-retired-still-going']);
		await captureFlow(app, 'retired-chat-archived');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
