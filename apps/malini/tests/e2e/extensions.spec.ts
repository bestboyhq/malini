import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	git,
	launchMalini,
	openWorkstream,
	recordBrowser,
	seedWorkstream,
	sendPrompt,
	type LaunchedApp,
} from './harness';
import { fakeBestboy, openUrl, signInUrl, type ExtensionFile } from './fake-bestboy';

function svelteExtension(version: string, publisher = 'szymeo'): ExtensionFile[] {
	return [
		{
			path: 'malini.json',
			text: JSON.stringify({
				apiVersion: 2,
				publisher,
				name: 'svelte',
				version,
				displayName: 'Svelte',
				description: 'Svelte 5 docs, the autofixer and best-practice skills, for every agent.',
				repository: 'https://github.com/sveltejs/ai-tools',
				contributes: { mcpServers: { svelte: { url: 'https://mcp.svelte.dev/mcp' } } },
			}),
		},
		{ path: 'README.md', text: '# Svelte\n\nAsk any chat to check a component.' },
		{ path: 'skills/runes/SKILL.md', text: '---\nname: runes\n---\nUse runes.' },
	];
}

function pluginsOfEachPrompt(app: LaunchedApp): string[][] {
	let text = '';
	try {
		text = readFileSync(join(app.home, 'malini-plugins.jsonl'), 'utf8');
	} catch {
		return [];
	}
	return text
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const entry: unknown = JSON.parse(line);
			const plugins =
				typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'plugins') : null;
			return Array.isArray(plugins) ? plugins.map(String) : [];
		});
}

async function openExtensions(page: Page): Promise<void> {
	await page.getByTestId('sidebar-open-extensions').click();
	await expect(page.getByRole('heading', { name: 'Extensions', level: 1 })).toBeVisible({
		timeout: 20_000,
	});
}

test('Discover installs an extension into the next prompt of every chat, Installed turns it off, and its page uninstalls it', async () => {
	test.setTimeout(240_000);
	const platform = await fakeBestboy();
	platform.listExtension(svelteExtension('1.0.4'));
	const app = await launchMalini({ env: { MALINI_BESTBOY_ORIGIN: platform.origin } });
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-extensions-ws', 'Extensions workstream');
		await openWorkstream(page, seeded.workstreamId);

		await openExtensions(page);
		const nav = page.getByRole('navigation', { name: 'Extensions' });
		await expect(nav.getByRole('link', { name: 'Discover' })).toHaveAttribute(
			'aria-current',
			'page',
		);
		const card = page.getByRole('article', { name: 'Svelte' });
		await expect(card).toContainText('@szymeo');
		await expect(card).toContainText('Svelte 5 docs, the autofixer');
		await page.mouse.move(0, 0);
		await captureFlow(app, 'extensions-1-discover');

		await card.getByRole('button', { name: 'Install Svelte' }).click();
		await expect(card).toContainText('Installed', { timeout: 20_000 });
		await expect(nav.getByRole('link', { name: /Installed/u })).toContainText('1');

		await openWorkstream(page, seeded.workstreamId);
		await sendPrompt(page, 'Which Svelte tools do you have?');
		await expectAssistantReply(page);
		await expect.poll(() => pluginsOfEachPrompt(app).at(-1)?.length ?? 0).toBe(1);
		const [folder] = pluginsOfEachPrompt(app).at(-1) ?? [];
		expect(folder).toMatch(/extensions\/installed\/svelte@1\.0\.4$/u);
		expect(readFileSync(join(folder ?? '', '.mcp.json'), 'utf8')).toContain('mcp.svelte.dev');
		expect(readFileSync(join(folder ?? '', 'skills/runes/SKILL.md'), 'utf8')).toContain(
			'Use runes.',
		);

		await openExtensions(page);
		await nav.getByRole('link', { name: /Installed/u }).click();
		await expect(page.getByRole('heading', { name: 'Installed', level: 1 })).toBeVisible();
		const onOff = page.getByRole('switch', { name: 'Svelte' });
		await expect(onOff).toHaveAttribute('aria-checked', 'true');
		await onOff.click();
		await expect(onOff).toHaveAttribute('aria-checked', 'false');
		await page.mouse.move(0, 0);
		await captureFlow(app, 'extensions-2-installed-off');

		const promptsBefore = pluginsOfEachPrompt(app).length;
		await openWorkstream(page, seeded.workstreamId);
		await sendPrompt(page, 'And now?');
		await expect.poll(() => pluginsOfEachPrompt(app).length).toBeGreaterThan(promptsBefore);
		expect(pluginsOfEachPrompt(app).at(-1)).toEqual([]);

		await openExtensions(page);
		await page
			.getByRole('article', { name: 'Svelte' })
			.getByRole('link', { name: 'Svelte' })
			.click();
		await expect(page.getByRole('heading', { name: 'Svelte', level: 1 })).toBeVisible();
		await expect(page.getByText('mcp.svelte.dev').first()).toBeVisible();
		await expect(page.getByText('Ask any chat to check a component.')).toBeVisible();
		await page.mouse.move(0, 0);
		await captureFlow(app, 'extensions-3-detail');
		await page.getByRole('button', { name: 'Uninstall' }).click();
		await expect(page.getByRole('button', { name: 'Install Svelte' })).toBeVisible({
			timeout: 20_000,
		});
		await expect(nav.getByRole('link', { name: /Installed/u })).not.toContainText('1');

		await page.getByTestId('extensions-nav').getByRole('link', { name: 'Workstreams' }).click();
		await expect(page.getByRole('navigation', { name: 'Extensions' })).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
		platform.close();
	}
});

test('Published signs in to Bestboy, claims a handle, and publishes what a repository commits', async () => {
	test.setTimeout(240_000);
	const platform = await fakeBestboy();
	const app = await launchMalini({ env: { MALINI_BESTBOY_ORIGIN: platform.origin } });
	try {
		const { page } = app;
		await recordBrowser(app);
		const source = await createSourceRepo(app.root, 'svelte-extension');
		for (const file of svelteExtension('1.0.0')) {
			mkdirSync(join(source, file.path, '..'), { recursive: true });
			writeFileSync(join(source, file.path), file.text);
		}
		await git(source, ['add', '.']);
		await git(source, ['commit', '-m', 'Svelte extension']);
		const seeded = await seedWorkstream(page, source, 'e2e-publish-ws', 'Publish workstream');
		await openWorkstream(page, seeded.workstreamId);

		await openExtensions(page);
		await page
			.getByRole('navigation', { name: 'Extensions' })
			.getByRole('link', { name: 'Published' })
			.click();
		await expect(page.getByRole('heading', { name: 'Published', level: 1 })).toBeVisible();
		const row = page.getByRole('article', { name: 'Svelte' });
		await expect(row).toContainText('Not published yet', { timeout: 20_000 });
		const publish = row.getByRole('button', { name: 'Publish 1.0.0' });
		await expect(publish).toBeDisabled();

		await page.getByRole('button', { name: 'Sign in' }).click();
		const { state } = await signInUrl(app, platform, 1);
		await openUrl(app, `malini://auth?code=e2e-code&state=${state}`);
		const bestboy = page.getByRole('region', { name: 'Bestboy' });
		await expect(bestboy).toContainText('no handle yet', { timeout: 20_000 });
		await page.getByLabel('Your handle').fill('szymeo');
		await page.getByRole('button', { name: 'Claim' }).click();
		await expect(bestboy).toContainText('@szymeo', { timeout: 20_000 });
		await expect(publish).toBeEnabled();
		await page.mouse.move(0, 0);
		await captureFlow(app, 'extensions-4-published');

		await publish.click();
		await expect(row).toContainText('Live 1.0.0', { timeout: 20_000 });
		const upload = platform.requests.find(
			({ method, path }) => method === 'POST' && path === '/api/extensions/szymeo/svelte/versions',
		);
		expect(upload?.authorization).toBe('Bearer e2e-token-1');
		expect(upload?.contentType).toBe('application/gzip');

		await page
			.getByRole('navigation', { name: 'Extensions' })
			.getByRole('link', { name: 'Discover' })
			.click();
		await expect(page.getByRole('article', { name: 'Svelte' })).toContainText('@szymeo');
		expectCleanConsole(app);
	} finally {
		await app.close();
		platform.close();
	}
});

test('Discover says when the marketplace cannot be reached and tries again', async () => {
	test.setTimeout(120_000);
	const platform = await fakeBestboy();
	const origin = platform.origin;
	platform.close();
	const app = await launchMalini({ env: { MALINI_BESTBOY_ORIGIN: origin } });
	try {
		const { page } = app;
		await page.evaluate(() => {
			location.hash = '#/extensions';
		});
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Extensions', level: 1 })).toBeVisible({
			timeout: 20_000,
		});
		await expect(page.getByText('Malini could not reach the marketplace')).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
