import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	invoke,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

test('a new Mac without Claude Code is walked to install it, with the command it will run', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ env: { FAKE_BRIDGE_CLAUDE_STATE: 'missing' } });
	try {
		const { page } = app;
		const setup = page.getByTestId('onboarding');
		await expect(
			setup.getByRole('heading', { name: 'Connect Claude Code and GitHub' }),
		).toBeVisible();
		await expect(
			setup.getByRole('list', { name: 'Setup progress' }).getByRole('listitem'),
		).toHaveCount(5);
		const claude = setup.getByTestId('claude-code-setup');
		await expect(claude).toHaveAttribute('data-claude-code-status', 'missing', { timeout: 20_000 });
		await expect(
			claude.getByRole('button', { name: 'Install Claude Code in Terminal' }),
		).toBeVisible();
		await expect(claude.getByText('curl -fsSL https://claude.ai/install.sh | bash')).toBeVisible();
		await captureFlow(app, 'first-run-install-claude');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a signed-out Claude Code asks to sign in and the composer will not send', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ env: { FAKE_BRIDGE_CLAUDE_STATE: 'needs_auth' } });
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-sign-in-ws', 'Sign in');
		await page.evaluate(() => {
			location.hash = '#/';
		});
		const claude = page.getByTestId('claude-code-setup');
		await expect(claude).toHaveAttribute('data-claude-code-status', 'signed-out');
		await expect(claude.getByRole('button', { name: 'Sign in to Claude Code' })).toBeVisible();
		await expect(claude.getByText('Sign in opens your browser.')).toBeVisible();
		await captureFlow(app, 'first-run-sign-in-claude');

		await openWorkstream(page, workstreamId);
		const picker = page.getByRole('button', { name: 'Model: Opus, Claude Code needs setup' });
		await expect(picker).toBeVisible({ timeout: 20_000 });
		await picker.click();
		const setup = page.getByTestId('chat-model-setup');
		await expect(setup).toContainText('Claude Code is installed but not signed in.');
		await expect(setup.getByRole('button', { name: 'Sign in to Claude Code' })).toBeVisible();
		await captureFlow(app, 'model-picker-sign-in-claude');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

type RehearsalCopy = { hidden: string | null; inert: boolean; named: number };

const REHEARSAL_COPY = ':has(> * > #onboarding-heading) > :not(:has(#onboarding-heading))';

test('onboarding rehearses its step transition on copies nobody can reach, and drops them on a step change', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const setup = page.getByTestId('onboarding');
		const copiesOnStage = (): Promise<number> =>
			setup.evaluate(
				(onboarding, copySelector) => onboarding.querySelectorAll(copySelector).length,
				REHEARSAL_COPY,
			);
		await expect(
			setup.getByRole('heading', { name: 'Connect Claude Code and GitHub' }),
		).toBeVisible();
		await setup.evaluate((onboarding, copySelector) => {
			const view = onboarding.ownerDocument.defaultView;
			const copies: RehearsalCopy[] = [];
			const seen = new WeakSet();
			new view.MutationObserver(() => {
				for (const copy of onboarding.querySelectorAll(copySelector)) {
					if (seen.has(copy)) continue;
					seen.add(copy);
					copies.push({
						hidden: copy.getAttribute('aria-hidden'),
						inert: copy.hasAttribute('inert'),
						named: copy.querySelectorAll('[id], [data-testid]').length,
					});
				}
			}).observe(onboarding, { childList: true, subtree: true });
			Reflect.set(view, 'rehearsalCopies', copies);
			view.dispatchEvent(new view.FocusEvent('focus'));
		}, REHEARSAL_COPY);
		const rehearsalCopies = (): Promise<RehearsalCopy[]> =>
			page.evaluate(() => Reflect.get(globalThis, 'rehearsalCopies'));

		await setup.getByRole('button', { name: 'Continue' }).click();
		await expect(setup.getByRole('heading', { name: 'Meet your jobs' })).toBeVisible();
		await setup.evaluate(
			(onboarding, copySelector) =>
				new Promise<void>((resolve) => {
					const look = (): void => {
						if (onboarding.querySelector(copySelector)) resolve();
						else onboarding.ownerDocument.defaultView.requestAnimationFrame(look);
					};
					look();
				}),
			REHEARSAL_COPY,
		);
		const continueOnCopies = await setup
			.getByRole('button', { name: 'Continue' })
			.evaluate((button, copySelector) => {
				const onboarding = button.closest('[data-testid="onboarding"]');
				const before = onboarding.querySelectorAll(copySelector).length;
				button.click();
				return { before, after: onboarding.querySelectorAll(copySelector).length };
			}, REHEARSAL_COPY);
		expect(continueOnCopies.before).toBeGreaterThan(0);
		expect(continueOnCopies.after).toBe(0);

		const sounds = setup.getByRole('heading', { name: 'Hear your afternoon' });
		await expect(sounds).toBeVisible();
		const copiedBefore = (await rehearsalCopies()).length;
		await expect.poll(async () => (await rehearsalCopies()).length).toBeGreaterThan(copiedBefore);
		await expect.poll(copiesOnStage, { timeout: 20_000 }).toBe(0);
		await expect(sounds).toHaveCount(1);
		await expect(page.locator('#onboarding-heading')).toHaveCount(1);

		const copies = await rehearsalCopies();
		expect(copies).toEqual(copies.map(() => ({ hidden: 'true', inert: true, named: 0 })));
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('setup asks where you heard about Malini, keeps your answer, and forgets it when you skip', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const setup = page.getByTestId('onboarding');
		const next = setup.getByRole('button', { name: 'Continue' });
		await next.click();
		await expect(setup.getByRole('heading', { name: 'Meet your jobs' })).toBeVisible();
		await next.click();
		await expect(setup.getByRole('heading', { name: 'Hear your afternoon' })).toBeVisible();
		await next.click();
		await expect(
			setup.getByRole('heading', { name: 'Where did you hear about Malini?' }),
		).toBeVisible();
		await expect(next).toBeDisabled();

		const channels = setup.getByRole('group', { name: 'Where you heard about Malini' });
		const hackerNews = channels.getByRole('button', { name: 'Hacker News' });
		await hackerNews.click();
		await expect(hackerNews).toHaveAttribute('aria-pressed', 'true');
		await expect(next).toBeEnabled();
		await captureFlow(app, 'setup-heard-about-hacker-news');

		await channels.getByRole('button', { name: 'Somewhere else' }).click();
		await expect(hackerNews).toHaveAttribute('aria-pressed', 'false');
		const where = setup.getByRole('textbox', { name: 'Where you heard about Malini' });
		await expect(where).toBeFocused();
		await where.fill('@syntaxfm podcast');
		await captureFlow(app, 'setup-heard-about-somewhere-else');
		await next.click();
		await expect(setup.getByRole('heading', { name: 'Open your first repository' })).toBeVisible();
		await expect
			.poll(async () => (await storedSettings(page))['heard-about'])
			.toBe('syntaxfm podcast');

		await setup.getByRole('button', { name: 'Back' }).click();
		await expect(where).toHaveValue('@syntaxfm podcast');
		await setup.getByRole('button', { name: 'Skip', exact: true }).click();
		await expect(setup.getByRole('heading', { name: 'Open your first repository' })).toBeVisible();
		await expect.poll(async () => (await storedSettings(page))['heard-about']).toBe('');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function storedSettings(page: Page): Promise<Record<string, string>> {
	return invoke<Record<string, string>>(page, 'app.list-settings', undefined);
}
