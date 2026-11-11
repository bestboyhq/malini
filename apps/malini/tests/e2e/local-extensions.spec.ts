import { execFileSync } from 'node:child_process';
import {
	closeSync,
	constants,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
	writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	clickRevealedOnHover,
	createSourceRepo,
	expectCleanConsole,
	type LaunchedApp,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	showInspector,
	temporaryRoot,
	withoutConsoleErrors,
} from './harness';

const HEALTHY = 'community.healthy';
const CRASHES = 'community.crashes';

function manifest(id: string, panels: readonly object[] = []): string {
	return JSON.stringify({
		schemaVersion: 1,
		id,
		name: id,
		version: '1.0.0',
		apiVersion: 1,
		description: `${id} fixture`,
		publisher: 'Community',
		entrypoint: './extension.mjs',
		activationEvents: ['onStartup'],
		contributes: { panels },
	});
}

function healthySource(revision: number): string {
	return `export default {
	activate(api) {
		api.events.on('malini.workstream.archived', () => {
			throw new Error('cleanup crashed');
		});
		api.panels.register({
			id: '${HEALTHY}.panel',
			label: 'Healthy',
			icon: 'file',
			order: 40,
			component: {
				workstreamScope: 'context',
				mount(target) {
					const doc = target.ownerDocument;
					const heading = doc.createElement('p');
					heading.textContent = 'Healthy revision ${revision}';
					const result = doc.createElement('p');
					const open = doc.createElement('button');
					open.textContent = 'Open links';
					open.onclick = async () => {
						await api.ui.openExternal('file:///etc/passwd');
						await api.ui.openExternal('https://example.com/readme');
						try {
							await api.workstream.readFile('../outside.txt');
							result.textContent = 'read outside the worktree';
						} catch {
							result.textContent = 'outside the worktree refused';
						}
					};
					target.append(heading, open, result);
					return { dispose: () => target.replaceChildren() };
				},
			},
		});
	},
};
`;
}

function installExtensions(home: string, root: string): string {
	const healthy = join(root, 'healthy');
	const crashes = join(root, 'crashes');
	for (const dir of [home, healthy, crashes]) mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(healthy, 'manifest.json'),
		manifest(HEALTHY, [{ id: `${HEALTHY}.panel`, label: 'Healthy', icon: 'file', order: 40 }]),
	);
	writeFileSync(join(healthy, 'extension.mjs'), healthySource(1));
	writeFileSync(join(crashes, 'manifest.json'), manifest(CRASHES));
	writeFileSync(
		join(crashes, 'extension.mjs'),
		"export default { activate() { throw new Error('extension crash'); } };",
	);
	writeFileSync(
		join(home, 'local.json'),
		JSON.stringify([
			{ id: HEALTHY, path: healthy, enabled: true, watch: true },
			{ id: CRASHES, path: crashes, enabled: true, watch: true },
		]),
	);
	return healthy;
}

function developmentLog(home: string): string[] {
	const path = join(home, 'development.log.ndjson');
	if (!existsSync(path)) return [];
	return readFileSync(path, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const entry: unknown = JSON.parse(line);
			const id: unknown = Reflect.get(Object(entry), 'extensionId');
			const event: unknown = Reflect.get(Object(entry), 'event');
			return `${String(id)} ${String(event)}`;
		});
}

async function recordOpenedLinks(app: LaunchedApp): Promise<void> {
	await app.electronApp.evaluate(({ shell }) => {
		const opened: string[] = [];
		Reflect.set(globalThis, '__openedLinks', opened);
		shell.openExternal = async (url) => {
			opened.push(url);
		};
	});
}

function openedLinks(app: LaunchedApp): Promise<string[]> {
	return app.electronApp.evaluate(() => {
		const opened: unknown = Reflect.get(globalThis, '__openedLinks');
		return Array.isArray(opened) ? opened.map(String) : [];
	});
}

async function showHealthyPanel(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Open inspector panel' }).click();
	await page.getByRole('menuitem', { name: 'Healthy' }).click();
	await expect(
		page.getByRole('region', { name: 'Inspector' }).getByRole('tab', { name: 'Healthy' }),
	).toHaveAttribute('aria-selected', 'true');
}

test.fixme(
	'a local extension runs from its folder without an app change, a crashing one stays isolated, edits reload it, a broken edit keeps the last good one, and its links and files stay fenced',
	{
		annotation: {
			type: 'blocked',
			description:
				"the renderer CSP (script-src 'self') blocks importing extension code from a data: URL, so local extensions never load in the built app",
		},
	},
	async () => {
		test.setTimeout(180_000);
		const root = temporaryRoot();
		const home = join(root, 'extension-home');
		const healthy = installExtensions(home, root);
		const app = await launchMalini({
			profile: root,
			env: { MALINI_EXTENSION_HOME: home },
			allowedDiagnostics: [/extension crash/u, /cleanup crashed|extension cleanup/u],
		});
		try {
			const { page } = app;
			const source = await createSourceRepo(app.root);
			const seeded = await seedWorkstream(page, source, 'e2e-local-extension', 'Local extension');
			const other = await seedWorkstream(page, source, 'e2e-local-extension-other', 'Other');
			await openWorkstream(page, seeded.workstreamId);
			await showInspector(page);
			await recordOpenedLinks(app);

			await showHealthyPanel(page);
			const inspector = page.getByRole('region', { name: 'Inspector' });
			await expect(inspector.getByText('Healthy revision 1')).toBeVisible({ timeout: 20_000 });
			await expect.poll(() => developmentLog(home)).toContain(`${HEALTHY} activated`);
			expect(developmentLog(home)).toContain(`${CRASHES} activation-failed`);
			await captureFlow(app, 'local-extension-panel');

			await inspector.getByRole('button', { name: 'Open links' }).click();
			await expect(inspector.getByText('outside the worktree refused')).toBeVisible();
			await expect.poll(() => openedLinks(app)).toEqual(['https://example.com/readme']);

			writeFileSync(join(healthy, 'extension.mjs'), healthySource(2));
			await expect
				.poll(() => developmentLog(home), { timeout: 20_000 })
				.toContain(`${HEALTHY} reloaded`);
			await showHealthyPanel(page);
			await expect(inspector.getByText('Healthy revision 2')).toBeVisible({ timeout: 20_000 });

			writeFileSync(join(healthy, 'extension.mjs'), 'export default { activate( };');
			await expect
				.poll(() => developmentLog(home), { timeout: 20_000 })
				.toContain(`${HEALTHY} load-failed`);
			await expect(inspector.getByText('Healthy revision 2')).toBeVisible();

			const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
			const row = sidebar.locator(
				`[data-testid="sidebar-workstream"][data-workstream-id="${other.workstreamId}"]`,
			);
			const archive = sidebar.locator(
				`[data-testid="sidebar-archive-workstream"][data-workstream-id="${other.workstreamId}"]`,
			);
			await clickRevealedOnHover(row, archive);
			await expect(
				page
					.getByTestId('toast')
					.filter({ hasText: 'Workstream archived, but its extension cleanup needs attention' }),
			).toBeVisible({ timeout: 20_000 });
			expectCleanConsole(app);
		} finally {
			await app.close();
		}
	},
);

test('recovery mode starts no local extension', async () => {
	test.setTimeout(120_000);
	const root = temporaryRoot();
	const home = join(root, 'extension-home');
	installExtensions(home, root);
	writeFileSync(join(home, 'recovery-mode'), 'enabled\n');
	const app = await launchMalini({ profile: root, env: { MALINI_EXTENSION_HOME: home } });
	try {
		const { page } = app;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-extension-recovery',
			'Extension recovery',
		);
		await openWorkstream(page, seeded.workstreamId);
		await expect
			.poll(() => developmentLog(home), { timeout: 20_000 })
			.toEqual(
				expect.arrayContaining([`${HEALTHY} recovery-skipped`, `${CRASHES} recovery-skipped`]),
			);
		await showInspector(page);
		await page.getByRole('button', { name: 'Open inspector panel' }).click();
		await expect(page.getByRole('menuitem', { name: 'New browser tab' })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: 'Healthy' })).toHaveCount(0);
		expect(developmentLog(home)).not.toContain(`${HEALTHY} activated`);
		await page.keyboard.press('Escape');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

const EXTENSION_FAILED =
	/An extension could not start|community\.(crashes|healthy)|dynamically imported module|Content Security Policy/u;

async function goToWorkstream(page: Page, workstreamId: string): Promise<void> {
	await page.evaluate(
		(next) => {
			globalThis.location.hash = next;
		},
		`#/workstreams/${encodeURIComponent(workstreamId)}`,
	);
	await expect(page.getByTestId('transcript-pane')).toBeVisible({ timeout: 20_000 });
}

test('a local extension that fails while Malini warms the last workstream says so once you open it', async () => {
	test.setTimeout(120_000);
	const root = temporaryRoot();
	const home = join(root, 'extension-home');
	installExtensions(home, root);
	const app = await launchMalini({
		profile: root,
		env: { MALINI_EXTENSION_HOME: home },
		allowedDiagnostics: [EXTENSION_FAILED],
	});
	try {
		const { page } = app;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-extension-warm',
			'Extension warm',
		);
		await page.reload();
		await expect
			.poll(() => developmentLog(home), { timeout: 20_000 })
			.toEqual(expect.arrayContaining([expect.stringMatching(/^community\.crashes \S+-failed$/u)]));

		await goToWorkstream(page, seeded.workstreamId);

		await expect(
			page.getByTestId('toast').filter({ hasText: 'An extension could not start' }).first(),
		).toBeVisible({ timeout: 20_000 });
		withoutConsoleErrors(app, EXTENSION_FAILED);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the inspector says it did not start when the warm-up ahead of it hangs', async () => {
	test.setTimeout(120_000);
	const root = temporaryRoot();
	const home = join(root, 'extension-home');
	mkdirSync(home, { recursive: true });
	const registry = join(home, 'local.json');
	execFileSync('mkfifo', [registry]);
	const held: { writer: number | null } = { writer: null };
	const app = await launchMalini({
		profile: root,
		env: { MALINI_EXTENSION_HOME: home },
		allowedDiagnostics: [/did not become ready/u],
	});
	try {
		const { page } = app;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-extension-warm-hangs',
			'Extension warm hangs',
		);
		await page.reload();
		await expect
			.poll(
				() => {
					try {
						held.writer = openSync(registry, constants.O_WRONLY | constants.O_NONBLOCK);
						return true;
					} catch {
						return false;
					}
				},
				{ timeout: 20_000 },
			)
			.toBe(true);

		await goToWorkstream(page, seeded.workstreamId);

		const failure = page.getByTestId('inspector-runtime-error');
		await expect(failure).toContainText(/did not become ready within 15 seconds/u, {
			timeout: 30_000,
		});
		await captureFlow(app, 'inspector-runtime-error-closed');
		await failure.getByRole('button', { name: 'Retry' }).click();
		await expect(failure).toHaveCount(0);
		await expect(failure).toContainText(/did not become ready within 15 seconds/u, {
			timeout: 30_000,
		});
		expectCleanConsole(app);
	} finally {
		if (held.writer !== null) {
			rmSync(registry);
			writeFileSync(registry, '[]');
			writeSync(held.writer, '[]');
			closeSync(held.writer);
		}
		await app.close();
	}
});
