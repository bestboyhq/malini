import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	KEYCHAIN_FIXTURE,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

const PRIVATE_ACCOUNT = 'me@private.example';
const WORK_ACCOUNT = 'me@work.example';

const PLAN_ALERT = /5-hour limit 93% used/u;

test('a Claude account added from the context card signs in through the browser once, then the card and Settings switch to it in one click', async () => {
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
		mkdirSync(join(app.home, KEYCHAIN_FIXTURE));
		writeFileSync(
			join(app.home, KEYCHAIN_FIXTURE, 'Claude Code-credentials'),
			login(PRIVATE_ACCOUNT),
		);
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

		const account = page.getByRole('region', { name: 'Claude account' });
		const accounts = account.getByRole('list', { name: 'Claude accounts' });
		const current = accounts.locator('[aria-current="true"]');
		const progress = account.getByRole('status');
		await usage.hover();
		await expect(current).toContainText(PRIVATE_ACCOUNT);
		await expect(current).toContainText('Claude Max');
		await account.getByRole('button', { name: 'Add account' }).click();

		await expect(progress).toHaveText('Continue in your browser.');
		await expect
			.poll(() => existsSync(argsFile) && readFileSync(argsFile, 'utf8'))
			.toBe('auth login\n');
		await captureFlow(app, 'claude-account-waiting-for-browser');
		writeFileSync(browserDone, '');
		await expect(current).toContainText(WORK_ACCOUNT, { timeout: 20_000 });
		await expect(usage).not.toHaveAccessibleName(PLAN_ALERT);
		const switchToPrivate = accounts.getByRole('button', { name: `Switch to ${PRIVATE_ACCOUNT}` });
		await expect(switchToPrivate).toBeVisible();
		await expect(account).toContainText(
			`This chat last ran on ${PRIVATE_ACCOUNT}. Its next prompt uses the checked account.`,
		);
		await captureFlow(app, 'claude-account-switch-back');

		rmSync(browserDone);
		await switchToPrivate.click();
		await expect(current).toContainText(PRIVATE_ACCOUNT, { timeout: 20_000 });
		expect(readFileSync(argsFile, 'utf8')).toBe(`auth login with refresh-${PRIVATE_ACCOUNT}\n`);
		await expect(usage).toHaveAccessibleName(PLAN_ALERT);
		await expect(account).not.toContainText('This chat last ran on');
		await expect(accounts.getByRole('button', { name: `Switch to ${WORK_ACCOUNT}` })).toBeVisible();

		await account.getByRole('button', { name: 'Add account' }).click();
		await expect(progress).toHaveText('Continue in your browser.');
		await account.getByRole('button', { name: 'Cancel signing in to Claude Code' }).click();
		await expect(progress).toHaveCount(0);
		await expect(current).toContainText(PRIVATE_ACCOUNT);

		await account.getByRole('button', { name: 'Manage accounts' }).click();
		const settings = page.getByRole('dialog', { name: 'Settings' });
		await expect(
			settings
				.getByRole('navigation', { name: 'Settings' })
				.getByRole('link', { name: 'Accounts' }),
		).toHaveAttribute('aria-current', 'page');
		await page.keyboard.press('Escape');
		await expect(settings).toHaveCount(0);

		await page.evaluate(() => {
			location.hash = '#/settings/privacy';
		});
		await page
			.getByRole('group', { name: 'Streamer mode' })
			.getByRole('button', { name: 'On' })
			.click();
		await page.evaluate(() => {
			location.hash = '#/settings';
		});
		const settingsAccounts = page
			.getByTestId('claude-code-setup')
			.getByRole('list', { name: 'Claude accounts' });
		const settingsCurrent = settingsAccounts.locator('[aria-current="true"]');
		await expect(settingsCurrent).toContainText('m***@***');
		await expect(settingsAccounts).not.toContainText(WORK_ACCOUNT);
		await expect(settingsAccounts).not.toContainText(PRIVATE_ACCOUNT);
		await captureFlow(app, 'claude-account-settings');
		await settingsAccounts.getByRole('button', { name: `Switch to ${WORK_ACCOUNT}` }).click();
		await expect
			.poll(() => readFileSync(argsFile, 'utf8'), { timeout: 20_000 })
			.toBe(`auth login with refresh-${WORK_ACCOUNT}\n`);
		await settingsCurrent.getByRole('button', { name: 'Reveal email address' }).click();
		await expect(settingsCurrent).toContainText(WORK_ACCOUNT, { timeout: 20_000 });
		expectCleanConsole(app);
	} finally {
		await app.close();
		rmSync(claude, { recursive: true, force: true });
	}
});

function login(email: string): string {
	return JSON.stringify({
		claudeAiOauth: { refreshToken: `refresh-${email}`, scopes: ['user:inference', 'user:profile'] },
	});
}

function claudeLoginStub(paths: {
	accountFile: string;
	argsFile: string;
	browserDone: string;
	newAccount: string;
}): string {
	const keychainItem = `"$HOME/${KEYCHAIN_FIXTURE}/Claude Code-credentials"`;
	return [
		'#!/bin/sh',
		'if [ "$1" = auth ] && [ "$2" = status ]; then',
		`  printf '{"loggedIn":true,"email":"%s"}\\n' "$(cat '${paths.accountFile}')"`,
		'  exit 0',
		'fi',
		'token="$CLAUDE_CODE_OAUTH_REFRESH_TOKEN"',
		`printf '%s%s\\n' "$*" "\${token:+ with $token}" > '${paths.argsFile}'`,
		'[ "$1" = auth ] && [ "$2" = login ] || exit 2',
		'if [ -n "$token" ]; then',
		'  email="${token#refresh-}"',
		'else',
		`  email='${paths.newAccount}'`,
		'  case "$3" in --email=*) email="${3#--email=}" ;; esac',
		'  echo "Opening browser to sign in…"',
		`  while [ ! -f '${paths.browserDone}' ]; do sleep 0.1; done`,
		'fi',
		`printf '%s\\n' "$email" > '${paths.accountFile}'`,
		`printf '{"claudeAiOauth":{"refreshToken":"refresh-%s","scopes":["user:inference","user:profile"]}}' "$email" > ${keychainItem}`,
		'echo "Login successful."',
		'',
	].join('\n');
}
