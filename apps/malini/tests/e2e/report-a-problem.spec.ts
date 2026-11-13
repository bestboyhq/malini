import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	ISSUE_CREATE_FIXTURE,
	captureFlow,
	connectFolder,
	expectCleanConsole,
	launchMalini,
	openedUrls,
	recordBrowser,
} from './harness';

const DISCORD = 'https://bestboy.dev/malini/discord';
const ISSUE = 'https://github.com/bestboyhq/malini/issues/214';

test('Help and feedback opens the Discord and files a problem with only the facts you kept', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await connectFolder(app, 'hutch');
		await recordBrowser(app);

		const help = page.getByRole('button', { name: 'Help and feedback' });
		const menu = page.getByRole('menu', { name: 'Help and feedback' });
		await help.click();
		await captureFlow(app, 'help-menu');
		await menu.getByRole('menuitem', { name: /^Join the Discord/ }).click();
		await expect(menu).toHaveCount(0);
		await expect.poll(() => openedUrls(app)).toEqual([DISCORD]);

		await help.click();
		await menu.getByRole('menuitem', { name: /^Report a problem/ }).click();
		const dialog = page.getByRole('dialog', { name: 'Report a problem' });
		const facts = dialog.getByRole('group', { name: 'Goes with it' });
		const system = facts.getByRole('checkbox', { name: /^Malini .+ · macOS / });
		const journey = facts.getByRole('checkbox', {
			name: /^\d+ repositor\w+ · \d+ prompts? · \d+ merges?$/,
		});
		await expect(system).toBeChecked();
		await expect(journey).toBeChecked();
		await expect(dialog).toContainText('Opens a public issue on bestboyhq/malini as @e2e-user.');
		const fileIssue = dialog.getByRole('button', { name: 'File issue' });
		await expect(fileIssue).toBeDisabled();

		await dialog
			.getByRole('textbox', { name: 'What broke' })
			.fill('Nothing ran when I pressed Enter\nNo error either');
		await journey.uncheck();
		await captureFlow(app, 'report-a-problem');
		await fileIssue.click();

		await expect(dialog).toContainText('Filed as #214');
		const args = readFileSync(join(app.home, ISSUE_CREATE_FIXTURE), 'utf8').split('\0');
		expect(args.slice(0, 6)).toEqual([
			'issue',
			'create',
			'--repo',
			'bestboyhq/malini',
			'--title',
			'Nothing ran when I pressed Enter',
		]);
		expect(args[6]).toBe('--body');
		expect(args[7]).toContain('Nothing ran when I pressed Enter\nNo error either\n\n---\n\n');
		expect(args[7]).toMatch(/\n- Malini \S+ · macOS \S+ \S+/);
		expect(args[7]).not.toContain('repositor');

		await dialog.getByRole('button', { name: 'Open on GitHub' }).click();
		await expect.poll(() => openedUrls(app)).toEqual([DISCORD, ISSUE]);
		await dialog.getByRole('button', { name: 'Done' }).click();
		await expect(dialog).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
