import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	recordBrowserAndClipboard,
	recordedBrowserAndClipboard,
	sendPrompt,
	type LaunchedApp,
} from './harness';
import {
	seedWorkstreamOnFakeGithub,
	sidebarStatus,
	topBarStatus,
	type FakeGithub,
} from './fake-github';

const WORKFLOW = '.github/workflows/map-tiles.yml';
const GITHUB_SAID = `refusing to allow an OAuth App to create or update workflow \`${WORKFLOW}\` without \`workflow\` scope`;
const REFUSED = /GitHub refused the push/u;

test('a push GitHub refuses says why in the chat, waits for you, and the agent reads the same note', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini({ allowedDiagnostics: [REFUSED] });
	try {
		const { page, github } = await refuseTheDraft(app, 'e2e-refused');

		const note = page.getByRole('region', { name: "Malini couldn't open the draft" });
		await expect(note).toBeVisible({ timeout: 60_000 });
		await expect(note.getByTestId('ship-failure-reason')).toHaveText(
			`GitHub refused the push: this change edits ${WORKFLOW}, and your gh sign-in can't change workflows. Run gh auth refresh -s workflow once, then retry.`,
		);
		await expect(note).toContainText(
			'1 try so far · waits for you · your agent reads this note too',
		);
		await expect(note.getByRole('button', { name: 'Allow workflow changes' })).toBeVisible();
		await expect(
			topBarStatus(page, /^Couldn't open draft · 1 try since \d\d:\d\d$/u),
		).toBeVisible();
		await expect(sidebarStatus(page, 'e2e-refused')).toHaveAccessibleName(
			/Needs you · Couldn't open draft/u,
		);

		const said = note.getByRole('button', { name: 'What GitHub said' });
		await said.click();
		await expect(said).toHaveAttribute('aria-expanded', 'true');
		await expect(note.getByTestId('ship-failure-github-said')).toContainText(GITHUB_SAID);

		await sendPrompt(page, "ECHO_SHIPPING why can't malini open the PR?");
		await expect(page.getByTestId('chat-message-bubble').last()).toContainText(
			"Shipping note: Malini couldn't open the draft. GitHub refused the push: this change edits",
			{ timeout: 30_000 },
		);
		await captureFlow(app, 'ship-failure-note');
		await expect(note).toContainText('1 try so far · waits for you');

		acceptPushes(github);
		await note.getByRole('button', { name: 'Retry now' }).click();

		await expect(page.getByRole('button', { name: 'Merge pull request #7' })).toBeEnabled({
			timeout: 90_000,
		});
		await expect(note).toHaveCount(0);
		await expect(sidebarStatus(page, 'e2e-refused')).not.toHaveAccessibleName(/Needs you/u);
		expect(github.pullRequest()).toMatchObject({ isDraft: true });
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Allow workflow changes adds the scope with a one-time code, then the draft opens on its own', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini({ allowedDiagnostics: [REFUSED] });
	try {
		await recordBrowserAndClipboard(app);
		const { page, github } = await refuseTheDraft(app, 'e2e-refused-allow');
		const note = page.getByRole('region', { name: "Malini couldn't open the draft" });
		await expect(note).toContainText('1 try so far · waits for you', { timeout: 60_000 });

		await note.getByRole('button', { name: 'Allow workflow changes' }).click();

		await expect(note.getByLabel('One-time code')).toHaveText('E2E0-C0DE');
		await expect(note.getByRole('button', { name: 'Retry now' })).toHaveCount(0);
		await expect
			.poll(() => recordedBrowserAndClipboard(app))
			.toEqual({ opened: ['https://github.com/login/device'], copied: ['E2E0-C0DE'] });
		expect(github.calls()).toContainEqual([
			'auth',
			'refresh',
			'--hostname',
			'github.com',
			'--scopes',
			'workflow',
		]);
		await captureFlow(app, 'ship-failure-allow-workflow-changes');

		acceptPushes(github);
		github.approveDevice();

		await expect(page.getByRole('button', { name: 'Merge pull request #7' })).toBeEnabled({
			timeout: 90_000,
		});
		await expect(note).toHaveCount(0);
		expect(github.pullRequest()).toMatchObject({ isDraft: true });
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Cancel draft stops opening a draft GitHub refuses', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini({ allowedDiagnostics: [REFUSED] });
	try {
		const { page, github } = await refuseTheDraft(app, 'e2e-refused-cancel');
		const note = page.getByRole('region', { name: "Malini couldn't open the draft" });
		await expect(note).toBeVisible({ timeout: 60_000 });

		await note.getByRole('button', { name: 'Cancel draft' }).click();

		await expect(note).toHaveCount(0);
		await expect(topBarStatus(page, '1 file changed')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Open a draft pull request' })).toBeEnabled();
		expect(github.pullRequest()).toBeNull();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function refuseTheDraft(
	app: LaunchedApp,
	workstreamId: string,
): Promise<{ page: Page; github: FakeGithub }> {
	const { page, github } = await seedWorkstreamOnFakeGithub(
		app,
		workstreamId,
		null,
		async (seeded) => {
			mkdirSync(join(seeded.worktree, '.github/workflows'), { recursive: true });
		},
	);
	const hook = join(github.remote, 'hooks/pre-receive');
	writeFileSync(hook, `#!/bin/sh\necho '${GITHUB_SAID}' >&2\nexit 1\n`);
	chmodSync(hook, 0o755);
	await openWorkstream(page, workstreamId);
	await sendPrompt(page, `EDIT:${WORKFLOW}`);
	await expectAssistantReply(page);
	await page.getByRole('button', { name: 'Open a draft pull request' }).click();
	return { page, github };
}

function acceptPushes(github: FakeGithub): void {
	rmSync(join(github.remote, 'hooks/pre-receive'), { force: true });
}
