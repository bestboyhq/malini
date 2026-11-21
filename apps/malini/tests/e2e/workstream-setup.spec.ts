import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { AutomationDefinitionRecord } from '../../src/contract/automations';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	git,
	invoke,
	launchMalini,
	lockFolder,
	REAL_GIT,
	seedWorkstream,
	unlockFolder,
	writeExecutable,
	type LaunchedApp,
} from './harness';

const TEN_LINES = '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n';
const WATCH_BASE = { MALINI_BASE_FETCH_MS: '1000', MALINI_BASE_QUIET_MS: '0' };

function sidebar(page: Page) {
	return page.getByRole('navigation', { name: 'Connected repositories' });
}

function workstreamRow(page: Page, workstreamId: string) {
	return sidebar(page).locator(
		`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`,
	);
}

function openedWorkstreamId(page: Page): string | null {
	return /#\/workstreams\/([^?/]+)/u.exec(page.url())?.[1] ?? null;
}

async function newWorkstream(page: Page, repository: string): Promise<string> {
	const before = openedWorkstreamId(page);
	await sidebar(page)
		.locator(`[data-testid="sidebar-connected-repository"][data-full-name="${repository}"]`)
		.hover();
	await sidebar(page)
		.getByRole('button', { name: `New workstream for ${repository}` })
		.click();
	await expect.poll(() => openedWorkstreamId(page), { timeout: 20_000 }).not.toBe(before);
	const opened = openedWorkstreamId(page);
	if (!opened) throw new Error('the new workstream did not open');
	await expect(workstreamRow(page, opened)).toHaveAttribute('aria-current', 'page', {
		timeout: 20_000,
	});
	return opened;
}

async function watchHeadlineOverlaps(
	page: Page,
): Promise<() => Promise<{ texts: string[]; overlaps: string[] }>> {
	const watch = await page.locator('body').evaluateHandle((body) => {
		const doc = body.ownerDocument;
		const texts = new Set<string>();
		const overlaps = new Set<string>();
		const sample = () => {
			const headline = doc.querySelector('[data-testid="global-topbar-github-headline"]');
			if (headline) {
				texts.add(headline.getAttribute('aria-label') ?? '');
				for (const parent of [headline, ...headline.querySelectorAll('*')]) {
					const children = [...parent.children].filter((child) =>
						child.checkVisibility({ opacityProperty: true }),
					);
					children.forEach((child, index) => {
						const a = child.getBoundingClientRect();
						for (const other of children.slice(index + 1)) {
							const b = other.getBoundingClientRect();
							if (
								a.left < b.right - 1 &&
								b.left < a.right - 1 &&
								a.top < b.bottom - 1 &&
								b.top < a.bottom - 1
							) {
								overlaps.add(`${child.textContent} over ${other.textContent}`);
							}
						}
					});
				}
			}
			doc.defaultView?.requestAnimationFrame(sample);
		};
		sample();
		return { texts, overlaps };
	});
	return () =>
		watch.evaluate(({ texts, overlaps }) => ({ texts: [...texts], overlaps: [...overlaps] }));
}

function setupStep(page: Page, label: string) {
	return page
		.getByRole('list', { name: 'Workstream setup' })
		.getByRole('listitem')
		.filter({ hasText: label });
}

async function connectCloneUrl(page: Page, source: string): Promise<void> {
	await invoke(page, 'repositories.connect', {
		source: { kind: 'clone-url', url: pathToFileURL(source).href },
	});
	await page.reload();
}

async function baseBranches(page: Page): Promise<Record<string, string>> {
	const listed = await invoke<{ id: string; baseBranch: string }[]>(
		page,
		'repositories.list-workstreams',
	);
	return Object.fromEntries(listed.map(({ id, baseBranch }) => [id, baseBranch]));
}

async function storedDefaultBranch(page: Page, fullName: string): Promise<string | undefined> {
	const clones = await invoke<{ fullName: string; defaultBranch: string }[]>(
		page,
		'repositories.list-clones',
	);
	return clones.find((clone) => clone.fullName === fullName)?.defaultBranch;
}

async function expectFreshCopy(page: Page): Promise<void> {
	await expect(setupStep(page, 'Made a fresh copy')).toBeVisible({ timeout: 30_000 });
	await expect(composerReady(page)).toBeVisible({ timeout: 30_000 });
}

function composerReady(page: Page) {
	return page.locator('[data-testid="chat-composer-input"][aria-disabled="false"]');
}

async function commitFiles(repo: string, files: Readonly<Record<string, string>>): Promise<void> {
	for (const [name, text] of Object.entries(files)) writeFileSync(join(repo, name), text);
	await git(repo, ['add', '.']);
	await git(repo, ['commit', '-m', 'add files']);
}

async function workstreamOnRenamedBase(
	page: Page,
	root: string,
	repository: string,
): Promise<{ workstreamId: string }> {
	const source = await createSourceRepo(root, repository);
	await commitFiles(source, { 'lines.txt': TEN_LINES });
	await connectCloneUrl(page, source);
	const workstreamId = await newWorkstream(page, repository);
	await expectFreshCopy(page);
	expect((await baseBranches(page))[workstreamId]).toBe('main');
	const listed = await invoke<{ id: string; path: string }[]>(
		page,
		'repositories.list-workstreams',
	);
	const worktree = listed.find(({ id }) => id === workstreamId)?.path;
	if (!worktree) throw new Error(`no checkout for ${workstreamId}`);
	await git(worktree, ['config', 'user.email', 'e2e@example.com']);
	await git(worktree, ['config', 'user.name', 'e2e']);
	await commitFiles(worktree, { 'lines.txt': TEN_LINES.replace('1\n', 'one\n') });

	await git(source, ['branch', '-m', 'main', 'trunk']);
	await commitFiles(source, { 'lines.txt': TEN_LINES.replace('10\n', 'ten\n') });
	return { workstreamId };
}

async function updateFromMainRuns(page: Page): Promise<string[][]> {
	const runs = await invoke<{ title: string; status: string; detail: string | null }[]>(
		page,
		'automations.list-runs',
	);
	return runs
		.filter(({ title }) => title === 'Update from main')
		.map(({ status, detail }) => [status, detail ?? '']);
}

function slowWorktreeAdd(app: LaunchedApp): void {
	const stub = join(app.bin, 'git');
	writeExecutable(
		stub,
		`#!/bin/sh\ncase " $* " in *" worktree add "*) sleep 4 ;; esac\nexec "${REAL_GIT}" "$@"\n`,
	);
}

function slowMerge(app: LaunchedApp): void {
	const stub = join(app.bin, 'git');
	writeExecutable(
		stub,
		`#!/bin/sh\ncase " $* " in *" merge --no-edit "*) sleep 3 ;; esac\nexec "${REAL_GIT}" "$@"\n`,
	);
}

function installNpmStub(app: LaunchedApp): { succeeds: string; held: string } {
	const succeeds = join(app.home, 'npm-succeeds');
	const held = join(app.home, 'npm-held');
	const stub = join(app.bin, 'npm');
	writeExecutable(
		stub,
		`#!/bin/sh\nwhile [ -f "${held}" ]; do sleep 0.1; done\nif [ -f "${succeeds}" ]; then exit 0; fi\necho "e2e install failure" 1>&2\nexit 1\n`,
	);
	return { succeeds, held };
}

test('a new workstream opens at once, sets itself up, and every new workstream joins the sidebar', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root, 'alpha');
		await seedWorkstream(page, source, 'e2e-setup-first', 'First work');
		await page.reload();
		await expect(workstreamRow(page, 'e2e-setup-first')).toBeVisible({ timeout: 20_000 });

		await seedWorkstream(page, source, 'e2e-setup-second', 'Second work');
		await expect(workstreamRow(page, 'e2e-setup-second')).toBeVisible({ timeout: 20_000 });

		const created = await newWorkstream(page, 'alpha');
		await expect(composerReady(page)).toBeVisible({ timeout: 30_000 });
		await expect(setupStep(page, 'Copy failed')).toHaveCount(0);
		await expect(sidebar(page).getByTestId('sidebar-workstream')).toHaveCount(3);
		await expect(workstreamRow(page, created)).toHaveAttribute('aria-current', 'page');
		await captureFlow(app, 'workstream-setup-ready');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a file pasted into a new workstream before its worktree exists shows at once and attaches once it does', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root, 'alpha');
		await seedWorkstream(page, source, 'e2e-setup-paste-seed', 'Seed work');
		await page.reload();
		await expect(workstreamRow(page, 'e2e-setup-paste-seed')).toBeVisible({ timeout: 20_000 });
		slowWorktreeAdd(app);

		await newWorkstream(page, 'alpha');
		const input = page.getByTestId('chat-composer-input');
		await input.click();
		await page.evaluate(`(() => {
			const data = new DataTransfer();
			data.items.add(new File(['early notes\\n'], 'early.txt', { type: 'text/plain' }));
			document
				.querySelector('[data-testid="chat-composer-input"]')
				.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
		})()`);

		await expect(input.getByLabel('Attaching early.txt')).toBeVisible({ timeout: 1_000 });
		await expect(input.getByLabel('Attached file: early.txt')).toBeVisible({ timeout: 30_000 });
		await expect(input.getByLabel('Attaching early.txt')).toHaveCount(0);
		await expect(page.getByTestId('chat-attachment-error')).toHaveCount(0);
		await captureFlow(app, 'workstream-setup-early-paste');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a failed setup says why in its steps, retries in place, and removes a failed one', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini({ allowedDiagnostics: [/permission denied/iu] });
	let lockedDirectory: string | null = null;
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root, 'alpha');
		const seeded = await seedWorkstream(page, source, 'e2e-setup-kept', 'Kept work');
		await page.reload();
		await expect(workstreamRow(page, seeded.workstreamId)).toBeVisible({ timeout: 20_000 });
		lockedDirectory = dirname(seeded.worktree);

		lockFolder(lockedDirectory);
		const headlineOverlaps = await watchHeadlineOverlaps(page);
		const retried = await newWorkstream(page, 'alpha');
		const failure = setupStep(page, 'Copy failed');
		await expect(failure).toContainText(/permission denied/iu, { timeout: 30_000 });
		await expect
			.poll(() =>
				failure
					.getByText(/permission denied/iu)
					.evaluateAll((nodes) => nodes.every((node) => node.scrollWidth <= node.clientWidth)),
			)
			.toBe(true);
		await expect(page.getByRole('alert')).toHaveCount(0);
		await expect(
			workstreamRow(page, retried).getByRole('status', {
				name: 'Workstream status: Setup failed',
			}),
		).toBeVisible();
		await expect
			.poll(async () => (await headlineOverlaps()).texts, { timeout: 30_000 })
			.toContain('Needs you · Setup failed');
		const watched = await headlineOverlaps();
		expect(watched.texts.some((text) => text.startsWith('Setting up'))).toBe(true);
		expect(watched.overlaps).toEqual([]);
		await expect(page.getByTestId('extension-inspector-gutter')).toBeVisible();
		await expect(page.getByTestId('global-topbar-github-headline')).toBeVisible();
		await captureFlow(app, 'workstream-setup-failed');

		unlockFolder(lockedDirectory);
		await failure.getByRole('button', { name: 'Retry setup' }).click();
		await expect(failure).toHaveCount(0, { timeout: 30_000 });
		await expect(setupStep(page, 'Made a fresh copy')).toBeVisible({ timeout: 30_000 });
		await expect(composerReady(page)).toBeVisible({ timeout: 30_000 });
		await expect(workstreamRow(page, retried)).toHaveAttribute('aria-current', 'page');

		lockFolder(lockedDirectory);
		const removed = await newWorkstream(page, 'alpha');
		await expect(failure).toBeVisible({ timeout: 30_000 });
		unlockFolder(lockedDirectory);
		await failure.getByRole('button', { name: 'Remove this workstream' }).click();

		await expect(workstreamRow(page, removed)).toHaveCount(0, { timeout: 30_000 });
		await expect.poll(() => openedWorkstreamId(page), { timeout: 20_000 }).not.toBe(removed);
		await expect(
			sidebar(page).locator('[data-testid="sidebar-workstream"][aria-current="page"]'),
		).toHaveCount(1);
		await expect(failure).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		if (lockedDirectory) unlockFolder(lockedDirectory);
		await app.close();
	}
});

test('a repository with only a master branch starts a workstream on master', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root, 'e2e/legacy', 'master');
		await connectCloneUrl(page, source);
		const opened = await newWorkstream(page, 'e2e/legacy');
		await expectFreshCopy(page);
		expect((await baseBranches(page))[opened]).toBe('master');
		expect(await storedDefaultBranch(page, 'e2e/legacy')).toBe('master');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a default branch renamed on origin after connecting starts the next workstream on the new name', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root, 'e2e/moved');
		await connectCloneUrl(page, source);
		const before = await newWorkstream(page, 'e2e/moved');
		await expectFreshCopy(page);
		expect((await baseBranches(page))[before]).toBe('main');

		await git(source, ['branch', '-m', 'main', 'trunk']);
		const after = await newWorkstream(page, 'e2e/moved');
		await expectFreshCopy(page);
		expect((await baseBranches(page))[after]).toBe('trunk');
		expect(await storedDefaultBranch(page, 'e2e/moved')).toBe('trunk');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a workstream started before origin renamed its base branch moves to the new name and updates from it', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ env: WATCH_BASE });
	try {
		const { page } = app;
		const { workstreamId } = await workstreamOnRenamedBase(page, app.root, 'e2e/renamed');

		await expect
			.poll(async () => (await baseBranches(page))[workstreamId], { timeout: 30_000 })
			.toBe('trunk');
		await expect
			.poll(() => updateFromMainRuns(page), { timeout: 60_000 })
			.toEqual([['succeeded', 'Merged 1 commit from trunk']]);
		expect(await storedDefaultBranch(page, 'e2e/renamed')).toBe('trunk');
		await captureFlow(app, 'workstream-base-renamed');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Update from main run right after origin renamed the base branch merges from the new name', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const { workstreamId } = await workstreamOnRenamedBase(page, app.root, 'e2e/renamed-now');
		const definitions = await invoke<AutomationDefinitionRecord[]>(
			page,
			'automations.list-definitions',
		);
		const update = definitions.find((definition) => definition.builtin === 'update-from-main');
		if (!update) throw new Error('Update from main is missing');

		await invoke(page, 'automations.run', { definitionId: update.id, workstreamId });

		await expect
			.poll(() => updateFromMainRuns(page), { timeout: 60_000 })
			.toEqual([['succeeded', 'Merged 1 commit from trunk']]);
		expect((await baseBranches(page))[workstreamId]).toBe('trunk');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a commit while Update from main runs starts no second Update from main', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ env: { MALINI_BASE_QUIET_MS: '0' } });
	try {
		const { page } = app;
		const { workstreamId } = await workstreamOnRenamedBase(page, app.root, 'e2e/renamed-busy');
		slowMerge(app);
		const listed = await invoke<{ id: string; path: string }[]>(
			page,
			'repositories.list-workstreams',
		);
		const worktree = listed.find(({ id }) => id === workstreamId)?.path;
		if (!worktree) throw new Error(`no checkout for ${workstreamId}`);
		const definitions = await invoke<AutomationDefinitionRecord[]>(
			page,
			'automations.list-definitions',
		);
		const update = definitions.find((definition) => definition.builtin === 'update-from-main');
		if (!update) throw new Error('Update from main is missing');

		await invoke(page, 'automations.run', { definitionId: update.id, workstreamId });
		await expect.poll(() => updateFromMainRuns(page)).toEqual([['running', '']]);
		await git(worktree, ['commit', '--allow-empty', '-m', 'Commit while the merge runs']);

		await expect
			.poll(() => updateFromMainRuns(page), { timeout: 60_000 })
			.toEqual([['succeeded', 'Merged 1 commit from trunk']]);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('an empty repository says so in the copy step and starts once it has a commit', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ allowedDiagnostics: [/Empty repository/u] });
	try {
		const { page } = app;
		const origin = join(app.root, 'e2e', 'blank');
		mkdirSync(origin, { recursive: true });
		await git(origin, ['init', '--bare', '-b', 'trunk']);
		await connectCloneUrl(page, origin);
		const opened = await newWorkstream(page, 'e2e/blank');
		const failure = setupStep(page, 'Copy failed');
		await expect(failure).toContainText('Empty repository. Push a first commit, then retry', {
			timeout: 30_000,
		});
		await captureFlow(app, 'workstream-setup-empty-repository');

		const firstCommit = await createSourceRepo(app.root, 'blank-first-commit');
		await git(firstCommit, ['push', origin, 'HEAD:refs/heads/trunk']);
		await failure.getByRole('button', { name: 'Retry setup' }).click();
		await expectFreshCopy(page);
		expect((await baseBranches(page))[opened]).toBe('trunk');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a dependency install that fails says why and retries, and an unknown project says none was installed', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini({ allowedDiagnostics: [/e2e install failure/u] });
	try {
		const { page } = app;
		const { succeeds, held } = installNpmStub(app);
		const locked = await createSourceRepo(app.root, 'locked');
		await commitFiles(locked, {
			'package.json': '{ "name": "locked", "version": "1.0.0" }\n',
			'package-lock.json': '{ "name": "locked", "lockfileVersion": 3, "packages": {} }\n',
		});
		const unknown = await createSourceRepo(app.root, 'unknown');
		await commitFiles(unknown, { 'package.json': '{ "name": "unknown" }\n' });
		await seedWorkstream(page, locked, 'e2e-install-locked', 'Locked work');
		await seedWorkstream(page, unknown, 'e2e-install-unknown', 'Unknown work');
		await page.reload();
		await expect(workstreamRow(page, 'e2e-install-locked')).toBeVisible({ timeout: 20_000 });

		const installing = await newWorkstream(page, 'locked');
		const steps = page.getByRole('list', { name: 'Workstream setup' }).getByRole('listitem');
		const failed = steps.filter({ hasText: 'Install failed' });
		await expect(failed).toContainText('e2e install failure', { timeout: 30_000 });
		await expect(page.getByTestId('chat-surface').locator('> *')).toHaveCount(1);
		await captureFlow(app, 'workstream-dependency-install-failed');

		const suggestions = page.getByRole('group', { name: 'Quick suggestions' });
		await expect(suggestions).toBeVisible();
		writeFileSync(succeeds, '');
		writeFileSync(held, '');
		await failed.getByRole('button', { name: 'Retry' }).click();
		await expect(steps.filter({ hasText: 'Checking dependencies' })).toBeVisible();
		await expect(suggestions).toHaveCount(0);
		rmSync(held);
		await expect(steps.filter({ hasText: 'Checked dependencies' })).toContainText('All in place', {
			timeout: 30_000,
		});
		await expect(failed).toHaveCount(0);
		await expect(suggestions).toBeVisible();
		await expect(workstreamRow(page, installing)).toHaveAttribute('aria-current', 'page');

		await newWorkstream(page, 'unknown');
		const skipped = steps.filter({ hasText: 'Checked dependencies' });
		await expect(skipped).toContainText('No lockfile. Installed nothing', { timeout: 30_000 });
		await expect(skipped.getByRole('button', { name: 'Retry' })).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
