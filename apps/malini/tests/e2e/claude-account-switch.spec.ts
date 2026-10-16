import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

const PRIVATE_ACCOUNT = 'me@private.example';
const WORK_ACCOUNT = 'me@work.example';

const PLAN_ALERT = /5-hour limit 93% used/u;

test('the model picker switches Claude accounts through a browser sign-in, and Settings offers the same', async () => {
	test.setTimeout(180_000);
	const claude = mkdtempSync(join(tmpdir(), 'malini-e2e-claude-'));
	const accountFile = join(claude, 'account');
	const argsFile = join(claude, 'args');
	const browserDone = join(claude, 'browser-done');
	writeFileSync(accountFile, PRIVATE_ACCOUNT);
	const app = await launchMalini({
		env: {
			FAKE_BRIDGE_CLAUDE_ACCOUNT_FILE: accountFile,
			FAKE_BRIDGE_USAGE: JSON.stringify({
				providerMetrics: {
					anthropic: {
						rateLimits: [
							{
								label: '5-hour limit',
								utilization: 93,
								resetsAt: new Date(Date.now() + 7_200_000).toISOString(),
							},
						],
						observedAt: new Date().toISOString(),
						account: PRIVATE_ACCOUNT,
					},
				},
			}),
		},
	});
	try {
		writeFileSync(
			join(app.bin, 'claude'),
			claudeLoginStub({ accountFile, argsFile, browserDone, newAccount: WORK_ACCOUNT }),
		);
		chmodSync(join(app.bin, 'claude'), 0o755);
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-claude-accounts-ws',
			'Claude accounts',
		);
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'Check usage');
		await expectAssistantReply(page);
		const usage = page.getByRole('button', { name: /^View context and plan usage/u });
		await expect(usage).toHaveAccessibleName(PLAN_ALERT);

		const picker = page.getByRole('button', { name: /^Model: / });
		const account = page.getByRole('group', { name: 'Claude account' });
		const waiting = page.getByTestId('chat-model-sign-in');
		await picker.click();
		await expect(account).toContainText(`Signed in as ${PRIVATE_ACCOUNT}`);
		await account.getByRole('button', { name: 'Sign in with another account' }).click();

		await picker.click();
		await expect(waiting).toContainText('Continue in your browser.');
		await expect
			.poll(() => existsSync(argsFile) && readFileSync(argsFile, 'utf8'))
			.toBe('auth login\n');
		await captureFlow(app, 'claude-account-waiting-for-browser');
		writeFileSync(browserDone, '');
		await expect(account).toContainText(`Signed in as ${WORK_ACCOUNT}`, { timeout: 20_000 });
		await expect(usage).not.toHaveAccessibleName(PLAN_ALERT);
		await expect(
			account.getByRole('button', { name: `Switch to ${PRIVATE_ACCOUNT}` }),
		).toBeVisible();
		await captureFlow(app, 'claude-account-switch-back');

		await account.getByRole('button', { name: `Switch to ${PRIVATE_ACCOUNT}` }).click();
		await picker.click();
		await expect(account).toContainText(`Signed in as ${PRIVATE_ACCOUNT}`, { timeout: 20_000 });
		expect(readFileSync(argsFile, 'utf8')).toBe(`auth login --email=${PRIVATE_ACCOUNT}\n`);
		await expect(usage).toHaveAccessibleName(PLAN_ALERT);
		await expect(account.getByRole('button', { name: `Switch to ${WORK_ACCOUNT}` })).toBeVisible();

		rmSync(browserDone);
		await account.getByRole('button', { name: 'Sign in with another account' }).click();
		await picker.click();
		await expect(waiting).toContainText('Continue in your browser.');
		await waiting.getByRole('button', { name: 'Cancel signing in to Claude Code' }).click();
		await expect(account).toContainText(`Signed in as ${PRIVATE_ACCOUNT}`);
		await page.keyboard.press('Escape');

		await page.evaluate(() => {
			location.hash = '#/settings';
		});
		const card = page.getByTestId('claude-code-setup');
		await expect(card.getByTestId('claude-code-detail')).toContainText(
			`Signed in as ${PRIVATE_ACCOUNT}`,
		);
		await card.getByRole('button', { name: 'Switch Claude account' }).click();
		await expect(
			page
				.getByRole('group', { name: 'Claude accounts' })
				.getByRole('button', { name: `Switch to ${WORK_ACCOUNT}` }),
		).toBeVisible();
		await captureFlow(app, 'claude-account-settings');
		await page.keyboard.press('Escape');
		expectCleanConsole(app);
	} finally {
		await app.close();
		rmSync(claude, { recursive: true, force: true });
	}
});

function claudeLoginStub(paths: {
	accountFile: string;
	argsFile: string;
	browserDone: string;
	newAccount: string;
}): string {
	return [
		'#!/bin/sh',
		`printf '%s\\n' "$*" > '${paths.argsFile}'`,
		'[ "$1" = auth ] && [ "$2" = login ] || exit 2',
		`email='${paths.newAccount}'`,
		'case "$3" in --email=*) email="${3#--email=}" ;; esac',
		'echo "Opening browser to sign in…"',
		`while [ ! -f '${paths.browserDone}' ]; do sleep 0.1; done`,
		`printf '%s\\n' "$email" > '${paths.accountFile}'`,
		'echo "Login successful."',
		'',
	].join('\n');
}
