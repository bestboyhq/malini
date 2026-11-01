import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
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

async function openSettings(page: Page, section: string): Promise<Locator> {
	await page.getByTestId('sidebar-open-settings').click();
	const settings = page.getByRole('dialog', { name: 'Settings' });
	await settings
		.getByRole('navigation', { name: 'Settings' })
		.getByRole('link', { name: section, exact: true })
		.click();
	await expect(settings.getByRole('heading', { name: section, level: 2 })).toBeVisible({
		timeout: 20_000,
	});
	return settings;
}

test('Settings, Extensions installs an extension into the next prompt of every chat, turns it off, and uninstalls it', async () => {
	test.setTimeout(240_000);
	const platform = await fakeBestboy();
	platform.listExtension(svelteExtension('1.0.4'));
	const app = await launchMalini({ env: { MALINI_BESTBOY_ORIGIN: platform.origin } });
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-extensions-ws', 'Extensions workstream');
		await openWorkstream(page, seeded.workstreamId);
		await expect(page.getByTestId('sidebar-open-extensions')).toHaveCount(0);

		let settings = await openSettings(page, 'Extensions');
		const available = settings.getByRole('list', { name: 'Extensions in the marketplace' });
		const listed = available.getByRole('listitem', { name: 'Svelte', exact: true });
		await expect(listed).toContainText('Svelte 5 docs, the autofixer');
		await listed.getByRole('button', { name: 'Svelte', exact: true }).click();
		await expect(listed.getByText('Ask any chat to check a component.')).toBeVisible();
		await expect(listed).toContainText('Connects to mcp.svelte.dev');
		await expect(listed.getByRole('list', { name: 'What Svelte adds' })).toContainText('runes');
		await page.mouse.move(0, 0);
		await captureFlow(app, 'extensions-1-marketplace');

		await listed.getByRole('button', { name: 'Install Svelte' }).click();
		const installed = settings.getByRole('list', { name: 'Installed extensions' });
		await expect(installed.getByRole('switch', { name: 'Svelte' })).toHaveAttribute(
			'aria-checked',
			'true',
			{ timeout: 20_000 },
		);
		await expect(available.getByRole('listitem', { name: 'Svelte', exact: true })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(settings).toHaveCount(0);

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

		settings = await openSettings(page, 'Extensions');
		const onOff = settings.getByRole('switch', { name: 'Svelte' });
		await onOff.click();
		await expect(onOff).toHaveAttribute('aria-checked', 'false');
		await page.mouse.move(0, 0);
		await captureFlow(app, 'extensions-2-installed-off');
		await page.keyboard.press('Escape');

		const promptsBefore = pluginsOfEachPrompt(app).length;
		await openWorkstream(page, seeded.workstreamId);
		await sendPrompt(page, 'And now?');
		await expect.poll(() => pluginsOfEachPrompt(app).length).toBeGreaterThan(promptsBefore);
		expect(pluginsOfEachPrompt(app).at(-1)).toEqual([]);

		settings = await openSettings(page, 'Extensions');
		const mine = settings
			.getByRole('list', { name: 'Installed extensions' })
			.getByRole('listitem', { name: 'Svelte', exact: true });
		await mine.getByRole('button', { name: 'Svelte', exact: true }).click();
		await mine.getByRole('button', { name: 'Uninstall' }).click();
		await expect(settings.getByRole('button', { name: 'Install Svelte' })).toBeVisible({
			timeout: 20_000,
		});
		await expect(settings.getByRole('list', { name: 'Installed extensions' })).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
		platform.close();
	}
});

test('Settings, Profile signs in to Bestboy, claims a handle, and publishes what a repository commits', async () => {
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

		const settings = await openSettings(page, 'Profile');
		const yours = settings.getByRole('region', { name: 'Extensions you publish' });
		const row = yours.getByRole('listitem', { name: 'Svelte' });
		await expect(row).toContainText('Not published yet', { timeout: 20_000 });
		const publish = row.getByRole('button', { name: 'Publish 1.0.0' });
		await expect(publish).toBeDisabled();
		await expect(yours).toContainText('Sign in to Bestboy above to publish.');

		await settings.getByRole('button', { name: 'Sign in' }).click();
		const { state } = await signInUrl(app, platform, 1);
		await openUrl(app, `malini://auth?code=e2e-code&state=${state}`);
		await expect(settings.getByText('Signed in to Bestboy as E2E Person')).toBeVisible({
			timeout: 20_000,
		});
		await yours.getByLabel('Publish under bestboy.dev/@').fill('szymeo');
		await yours.getByRole('button', { name: 'Claim' }).click();
		await expect(publish).toBeEnabled({ timeout: 20_000 });
		await yours.scrollIntoViewIfNeeded();
		await page.mouse.move(0, 0);
		await captureFlow(app, 'extensions-4-publish');

		await publish.click();
		await expect(row).toContainText('Published 1.0.0', { timeout: 20_000 });
		const upload = platform.requests.find(
			({ method, path }) => method === 'POST' && path === '/api/extensions/szymeo/svelte/versions',
		);
		expect(upload?.authorization).toBe('Bearer e2e-token-1');
		expect(upload?.contentType).toBe('application/gzip');

		await settings
			.getByRole('navigation', { name: 'Settings' })
			.getByRole('link', { name: 'Extensions', exact: true })
			.click();
		await expect(
			settings
				.getByRole('list', { name: 'Extensions in the marketplace' })
				.getByRole('listitem', { name: 'Svelte', exact: true }),
		).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
		platform.close();
	}
});

test('Settings, Extensions says when the marketplace cannot be reached and tries again', async () => {
	test.setTimeout(120_000);
	const platform = await fakeBestboy();
	const origin = platform.origin;
	platform.close();
	const app = await launchMalini({ env: { MALINI_BESTBOY_ORIGIN: origin } });
	try {
		const { page } = app;
		await page.evaluate(() => {
			location.hash = '#/settings/extensions';
		});
		await page.reload();
		const settings = page.getByRole('dialog', { name: 'Settings' });
		await expect(settings.getByRole('heading', { name: 'Extensions', level: 2 })).toBeVisible({
			timeout: 20_000,
		});
		await expect(settings.getByText('Malini could not reach the marketplace')).toBeVisible({
			timeout: 30_000,
		});
		await expect(settings.getByRole('button', { name: 'Try again' })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
