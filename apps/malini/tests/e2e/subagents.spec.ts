import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

declare global {
	var subagentTitles: string[];
}

test('parallel subagents tick under one live parent line, fold into it once back, and open on their reports', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		await seedWorkstream(page, source, 'e2e-subagents-ws', 'Subagents workstream');
		await openWorkstream(page, 'e2e-subagents-ws');

		await page.locator('body').evaluate((body) => {
			const titles: string[] = [];
			globalThis.subagentTitles = titles;
			const view = body.ownerDocument.defaultView;
			if (!view) throw new Error('the transcript has no window');
			new view.MutationObserver(() => {
				for (const title of body.querySelectorAll('[data-testid="subagent-title"]')) {
					const walker = body.ownerDocument.createTreeWalker(title, view.NodeFilter.SHOW_TEXT);
					let spoken = '';
					while (walker.nextNode()) {
						if (walker.currentNode.parentElement?.closest('[aria-hidden="true"]')) continue;
						spoken += walker.currentNode.textContent ?? '';
					}
					if (!titles.includes(spoken.trim())) titles.push(spoken.trim());
				}
			}).observe(body, { childList: true, subtree: true, characterData: true });
		});
		await sendPrompt(page, 'SUBAGENTS');

		const group = page.getByTestId('subagent-group');
		const parent = group.getByTestId('subagent-group-summary');
		const rows = page.getByTestId('subagent-row');
		const auth = rows.filter({ hasText: 'Map the auth flow' });
		const tests = rows.filter({ hasText: 'Audit the auth tests' });
		const release = (): void => writeFileSync(join(app.home, 'release-subagent'), '');
		await expect(group.getByTestId('subagent-row')).toHaveCount(2, { timeout: 20_000 });
		await expect(parent).toHaveAttribute('aria-expanded', 'true');
		await expect(group.getByTestId('subagent-group-title')).toContainText('2 subagents');
		await expect(group.getByTestId('subagent-group-ticker')).toHaveText('0 of 2 back');
		await expect(group.getByTestId('subagent-group-meta')).toHaveText(/^\d+s$/u);
		await expect(auth).toHaveAttribute('data-tool-status', 'running');
		await expect(auth.getByTestId('subagent-ticker')).toHaveText('Read · src/auth.ts');
		await expect(auth.getByTestId('subagent-meta')).toHaveText(/^1 step · \d+s$/u);
		await expect(tests.getByTestId('subagent-ticker')).toHaveText('Grep · signIn');
		await expect(page.locator('[data-message-kind="tool"]')).toHaveCount(0);
		expect(
			await page.evaluate(() => globalThis.subagentTitles),
			'every title a subagent row showed',
		).toEqual(['Map the auth flow', 'Audit the auth tests']);
		await captureFlow(app, 'subagents-running');

		release();

		await expect(auth.getByTestId('subagent-ticker')).toHaveText('Find token reads');
		await expect(auth.getByTestId('subagent-meta')).toContainText('2 steps');
		await expect(tests.getByTestId('subagent-ticker')).toHaveText('Glob · tests/**/*.spec.ts');
		await expect(page.locator('[data-message-kind="bash"]')).toHaveCount(0);
		await captureFlow(app, 'subagents-ticking');

		release();

		await expect(group.getByTestId('subagent-group-ticker')).toHaveText('2 of 2 back', {
			timeout: 20_000,
		});
		await expect(parent).toHaveAttribute('aria-expanded', 'false');
		await expect(rows).toHaveCount(0);
		await expect(group.getByTestId('subagent-group-meta')).toHaveText(/^\d+ steps/u);
		await expect(
			page.getByTestId('markdown-text').getByText('Both agents are back.', { exact: false }),
		).toBeVisible();
		await expect(page.getByTestId('chat-composer-submit')).toHaveAccessibleName('Send prompt');
		await captureFlow(app, 'subagents-folded');

		await parent.click();

		await expect(auth).toHaveAttribute('data-tool-status', 'completed');
		await expect(auth.getByTestId('subagent-ticker')).toHaveText('Auth runs through src/auth.ts');
		await expect(auth.getByTestId('subagent-meta')).toContainText('2 steps');
		await expect(tests.getByTestId('subagent-ticker')).toHaveText('Two specs cover sign-in.');

		await auth.getByTestId('subagent-summary').click();

		const steps = auth.getByTestId('subagent-steps');
		await expect(steps.getByTestId('subagent-prompt')).toHaveText(
			'Trace how a session token is read and refreshed.',
		);
		await expect(steps.locator('[data-message-kind="tool"]')).toHaveCount(1);
		await expect(steps.locator('[data-message-kind="bash"]')).toHaveCount(1);
		await expect(
			steps.getByTestId('subagent-result').getByRole('heading', { name: 'Auth runs through' }),
		).toBeVisible();
		await expect(page.locator('[data-message-kind="bash"]')).toHaveCount(1);
		await captureFlow(app, 'subagents-opened');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
