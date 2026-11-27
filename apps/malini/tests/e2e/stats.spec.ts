import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';
import {
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	showInspector,
} from './harness';

test('the sidebar reads out what malini uses and opens stats on its runs, tabs and memory', async () => {
	test.setTimeout(120_000);
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end('<!doctype html><title>Served page</title><h1>Served page</h1>');
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-stats-ws', 'Stats');
		await openWorkstream(page, workstreamId);
		await showInspector(page);
		await sendPrompt(page, 'Count this run');
		await expectAssistantReply(page);

		await page.getByRole('button', { name: 'Open inspector panel' }).click();
		await page.getByRole('menuitem', { name: 'Browser', exact: true }).click();
		const address = page.getByRole('textbox', { name: 'Page address' }).last();
		await address.fill(`${origin}/`);
		await address.press('Enter');

		const readout = page.getByRole('button', { name: /^Stats: \d+(\.\d)? (MB|GB) · \S+% CPU$/u });
		await expect(readout).toBeVisible({ timeout: 20_000 });
		await readout.click();

		const stats = page.getByRole('dialog', { name: 'Stats' });
		const rightNow = stats.getByRole('region', { name: 'Right now' });
		await expect(rightNow.getByRole('listitem').filter({ hasText: 'Malini' })).toBeVisible();
		await expect(rightNow.getByRole('listitem').filter({ hasText: 'Browser tabs' })).toBeVisible({
			timeout: 20_000,
		});

		await rightNow.getByRole('button', { name: /^Browser tabs/u }).click();
		await expect(rightNow.getByText('Pages open in browser tabs.')).toBeVisible();
		await expect(rightNow.getByRole('list', { name: 'Browser tabs breakdown' })).toContainText(
			'Served page',
		);
		await rightNow.getByRole('button', { name: /^Malini/u }).click();
		await expect(
			rightNow.getByRole('list', { name: 'Malini breakdown' }).getByRole('listitem'),
		).toContainText([/^Main process/u]);

		const activity = stats.getByRole('region', { name: 'Activity' });
		await expect(activity.getByText('agent runs')).toBeVisible();
		await expect(
			activity.getByRole('img', { name: 'Runs per day: 1 day in the last 6 months' }),
		).toBeVisible();
		await expect(
			activity.getByRole('list', { name: 'Runs by repository' }).getByRole('listitem'),
		).toHaveText([/1$/u]);
		await expect(activity.getByRole('list', { name: 'Activity at a glance' })).toContainText(
			'1 run',
		);
		const trimmed = activity.getByRole('region', { name: 'Kept out of context' });
		await expect(trimmed).toHaveCount(0);

		await page.keyboard.press('Escape');
		await expect(stats).toBeHidden();
		seedRtkHistory(app.home, [
			['grep -rn TODO src', 4_000, 1_000, 3_000],
			['grep -n render app.ts', 2_000, 500, 1_500],
			['ls -la', 1_200, 400, 800],
			['git log', 9_000, 2_000, 7_000],
		]);
		await readout.click();
		await expect(stats).toBeVisible();
		await expect(trimmed).toContainText('3 commands · last 90 days');
		await expect(trimmed.getByTestId('stats-tokens-trimmed')).toHaveText('5K');
		await expect(trimmed.getByTestId('stats-output-trimmed')).toHaveText('74%');
		const programs = trimmed.getByRole('list', { name: 'Tokens trimmed by command' });
		await expect(programs.getByRole('listitem')).toHaveText([/grep\s+5K/u, /ls\s+800/u]);
		await programs.getByRole('button', { name: /^grep/u }).click();
		await expect(programs).toContainText('2 commands · 75% shorter');

		await page.getByTestId('global-topbar-automations').click({ force: true });
		await expect(page.getByTestId('stats-panel-layer')).toBeHidden();
		await expect(page.getByRole('navigation', { name: 'Automations' })).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});

function seedRtkHistory(
	home: string,
	rows: readonly (readonly [command: string, input: number, output: number, saved: number])[],
): void {
	const folder = join(home, 'Library', 'Caches', 'malini-rtk');
	mkdirSync(folder, { recursive: true });
	const db = new DatabaseSync(join(folder, 'history.db'));
	db.exec(`CREATE TABLE commands (
		id INTEGER PRIMARY KEY,
		timestamp TEXT NOT NULL,
		original_cmd TEXT NOT NULL,
		rtk_cmd TEXT NOT NULL,
		input_tokens INTEGER NOT NULL,
		output_tokens INTEGER NOT NULL,
		saved_tokens INTEGER NOT NULL,
		savings_pct REAL NOT NULL,
		exec_time_ms INTEGER DEFAULT 0,
		project_path TEXT DEFAULT ''
	)`);
	const insert = db.prepare(
		`INSERT INTO commands (timestamp, original_cmd, rtk_cmd, input_tokens, output_tokens, saved_tokens, savings_pct)
		 VALUES ('2026-11-20T10:00:00Z', ?, ?, ?, ?, ?, 0)`,
	);
	for (const [command, input, output, saved] of rows) {
		insert.run(command, `rtk ${command}`, input, output, saved);
	}
	db.close();
}
