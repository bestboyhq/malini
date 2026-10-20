import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	APP_ROOT,
	CONTEXT_ROOT,
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

const LATEST_RUN = '[data-testid="chat-message-list"] > li[data-run-id]:last-child';
const BASH_LINES = 5_000;

async function expectLatestRunCompleted(page: Page): Promise<void> {
	await expect(page.locator(LATEST_RUN)).toHaveAttribute('data-run-terminal', 'completed', {
		timeout: 30_000,
	});
}

async function openSettings(page: Page, section: string): Promise<void> {
	await page.evaluate(
		(hash) => {
			location.hash = hash;
		},
		`#/settings${section ? `/${section}` : ''}`,
	);
}

test('a chat renders code, long command output, images and masked paths', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-rendering-ws', 'Rendering workstream');
		mkdirSync(join(seeded.worktree, 'shots'), { recursive: true });
		copyFileSync(join(APP_ROOT, 'build/icon.png'), join(seeded.worktree, 'shots/icon.png'));
		await openWorkstream(page, seeded.workstreamId);

		await sendPrompt(page, 'RICH_MARKDOWN SHOW_IMAGE:shots/icon.png');
		await expectLatestRunCompleted(page);
		const run = page.locator(LATEST_RUN);
		await expect(run.getByRole('cell', { name: '96' })).toBeVisible({ timeout: 30_000 });
		const codeBlock = run.getByTestId('markdown-code-block');
		await expect(codeBlock).toBeVisible();
		await expect(codeBlock.getByTestId('markdown-code-language')).toHaveText('TypeScript');

		const image = run.getByRole('button', { name: 'Open image shots/icon.png in gallery' });
		await expect(image).toHaveJSProperty('loading', 'lazy');
		await image.scrollIntoViewIfNeeded();
		await expect
			.poll(() =>
				image.evaluate((element) => Number('naturalWidth' in element ? element.naturalWidth : 0)),
			)
			.toBeGreaterThan(0);

		await run
			.getByRole('heading', { name: 'Rendering check' })
			.evaluate((element) => element.scrollIntoView({ block: 'start' }));
		await page.waitForTimeout(300);
		await captureFlow(app, 'transcript-rendering-markdown');
		await codeBlock.evaluate((element) => element.scrollIntoView({ block: 'start' }));
		await page.waitForTimeout(300);
		await captureFlow(app, 'transcript-rendering-code');
		await codeBlock.hover();
		await codeBlock.getByRole('button', { name: 'Copy code' }).hover();
		await page.waitForTimeout(700);
		await captureFlow(app, 'transcript-rendering-copy-tooltip');
		await electronApp.evaluate(({ clipboard }) => clipboard.writeText(''));
		await codeBlock.getByRole('button', { name: 'Copy code' }).click();
		await expect(codeBlock.getByRole('button', { name: 'Code copied' })).toBeVisible();
		await expect
			.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
			.toContain('export function step31(input: number): number {');
		const copied = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
		expect(copied.split('\n')).toHaveLength(96);
		await expect(codeBlock.getByRole('button', { name: 'Copy code' })).toBeVisible({
			timeout: 5_000,
		});

		await openSettings(page, 'privacy');
		const streamerMode = page.getByRole('group', { name: 'Streamer mode' });
		await streamerMode.getByRole('button', { name: 'On' }).click();
		await openWorkstream(page, seeded.workstreamId);
		const reveal = run.getByRole('button', { name: 'Reveal user name' });
		await expect(reveal.first()).toBeVisible();
		await captureFlow(app, 'transcript-rendering-masked');
		const masked = await reveal.count();
		await reveal.first().click();
		await expect(reveal).toHaveCount(masked - 1);
		await expect(run.getByText('/Users/ada/notes.md').first()).toBeVisible();
		await openSettings(page, 'privacy');
		await streamerMode.getByRole('button', { name: 'Off' }).click();
		await openWorkstream(page, seeded.workstreamId);
		await expect(run.getByText('/Users/ada/notes.md')).toBeVisible();
		await expect(reveal).toHaveCount(0);

		await sendPrompt(page, `BIG_BASH:${BASH_LINES}`);
		await expectLatestRunCompleted(page);
		await page.locator(LATEST_RUN).getByTestId('bash-command-toggle').click();
		const output = page.locator(LATEST_RUN).getByTestId('command-output-scroll');
		await expect(output).toContainText('build line 1\n');
		await expect(output).not.toContainText(`build line ${BASH_LINES}`);
		await output.getByRole('button', { name: /Show full output/u }).click();
		await expect(output).toContainText(`build line ${BASH_LINES}`);
		await expect(output).not.toContainText(`build line ${BASH_LINES / 2}\n`);
		await output.screenshot({ path: join(CONTEXT_ROOT, 'e2e-transcript-rendering-bash.png') });
		await captureFlow(app, 'transcript-rendering-bash-capped');
		await output.getByRole('button', { name: `Show all ${BASH_LINES} lines` }).click();
		await expect(output).toContainText(`build line ${BASH_LINES / 2}\n`);
		await expect(output.getByRole('button', { name: /Show all/u })).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a prompt shows back exactly what was typed, markup and markdown included, and never runs it', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-prompt-text-ws', 'Prompt text');
		await openWorkstream(page, seeded.workstreamId);
		const written = 'plain <b>bold</b> <img src=x onerror=alert(1)> **stars** <!-- note --> a < b';

		await sendPrompt(page, written);
		await expectLatestRunCompleted(page);
		const bubble = page.getByTestId('chat-message-bubble-user');
		await expect(bubble).toHaveText(written);
		await expect(bubble.getByRole('img')).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
