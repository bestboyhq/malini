import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	CONTEXT_ROOT,
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	invoke,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	startFreshChat,
	type LaunchedApp,
} from './harness';

const execFileAsync = promisify(execFile);

const FILES = {
	'alpha.ts': 'export const alpha = 1;\n',
	'beta.ts': 'export const beta = 2;\n',
	'gamma.ts': 'export const gamma = 3;\n',
} as const;

type FileName = keyof typeof FILES;

function strip(page: Page): Locator {
	return page.getByRole('tablist', { name: 'Chats and files' });
}

function tabRow(page: Page): Locator {
	return page.getByTestId('chat-agent-tabs');
}

function fileTab(page: Page, name: FileName): Locator {
	return tabRow(page).getByRole('tab', { name, exact: true });
}

function chatTab(page: Page, name: RegExp): Locator {
	return tabRow(page).getByRole('tab', { name });
}

async function expectStrip(page: Page, tabs: readonly string[]): Promise<void> {
	await expect(strip(page)).toMatchAriaSnapshot(
		[
			'- tablist "Chats and files":',
			'  - /children: equal',
			...tabs.map((tab) => `  - ${tab}`),
		].join('\n'),
	);
	await expect(tabRow(page).getByRole('tab')).toHaveCount(tabs.length);
	await expect(startChatButton(page)).toBeVisible();
}

async function expectOnlyTabs(page: Page): Promise<void> {
	const [list, ...lines] = (await strip(page).ariaSnapshot()).split('\n');
	const children = lines.filter((line) => /^ {2}- /u.test(line));
	expect(list).toBe('- tablist "Chats and files":');
	expect(children.length).toBeGreaterThan(0);
	expect(children.filter((line) => !line.startsWith('  - tab '))).toEqual([]);
}

function startChatButton(page: Page): Locator {
	return page.getByRole('button', { name: 'Start a fresh chat', exact: true });
}

async function workstreamWithFiles(
	app: LaunchedApp,
	workstreamId: string,
	files: Readonly<Record<string, string>> = FILES,
): Promise<void> {
	const { page } = app;
	const source = await createSourceRepo(app.root);
	for (const [name, contents] of Object.entries(files)) {
		mkdirSync(dirname(join(source, name)), { recursive: true });
		writeFileSync(join(source, name), contents);
	}
	await execFileAsync('git', ['-C', source, 'add', '.']);
	await execFileAsync('git', ['-C', source, 'commit', '-m', 'files']);
	const seeded = await seedWorkstream(page, source, workstreamId, 'Open files workstream');
	await openWorkstream(page, seeded.workstreamId);
	await expect(page.getByRole('treeitem', { name: 'Open seed.txt' })).toBeVisible({
		timeout: 20_000,
	});
}

async function workstreamWithMentions(app: LaunchedApp, workstreamId: string): Promise<void> {
	await workstreamWithFiles(app, workstreamId);
	await sendPrompt(app.page, `MENTION:${Object.keys(FILES).join(',')}`);
	await expectAssistantReply(app.page);
}

async function openMention(page: Page, name: FileName): Promise<void> {
	await chatTab(page, /MENTION/u).click();
	await page.getByRole('link', { name: `Open ${name}` }).click();
}

async function expectShowing(page: Page, name: FileName): Promise<void> {
	await expect(fileTab(page, name)).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByRole('tabpanel', { name })).toContainText(FILES[name], {
		timeout: 20_000,
	});
}

async function chatAbout(page: Page, prompt: string): Promise<void> {
	const previous = currentSessionId(page);
	await startFreshChat(page);
	await sendPrompt(page, prompt);
	await expectAssistantReply(page);
	await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).not.toBe(previous);
}

test('clicking a file mention opens it in a center tab and leaves the inspector without a file tab', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await workstreamWithMentions(app, 'e2e-open-file-ws');

		await openMention(page, 'alpha.ts');

		await expect(fileTab(page, 'alpha.ts')).toHaveAttribute('aria-selected', 'true');
		await expect(chatTab(page, /MENTION/u)).toHaveAttribute('aria-selected', 'false');
		await expectShowing(page, 'alpha.ts');
		await expect(fileTab(page, 'alpha.ts')).toHaveAccessibleDescription('Preview');
		await expectStrip(page, ['tab /MENTION/', 'tab "alpha.ts"']);
		await expect(page.getByRole('tablist', { name: 'Inspector panels' })).toMatchAriaSnapshot(
			['- tablist "Inspector panels":', '  - /children: equal', '  - tab "Files"'].join('\n'),
		);
		await page.mouse.move(0, 0);
		await captureFlow(app, 'open-file-1-center-tab');

		await chatTab(page, /MENTION/u).click();
		await expect(fileTab(page, 'alpha.ts')).toHaveAttribute('aria-selected', 'false');
		await expect(chatTab(page, /MENTION/u)).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByRole('tabpanel', { name: 'alpha.ts' })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Open beta.ts' })).toBeVisible();

		await page.mouse.move(0, 0);
		await captureFlow(app, 'open-file-1-back-to-chat');

		await startChatButton(page).focus();
		await page.keyboard.press('Enter');
		await expect(tabRow(page).getByRole('tab', { name: 'New chat', exact: true })).toHaveAttribute(
			'aria-selected',
			'true',
		);
		await expectStrip(page, ['tab /MENTION/', 'tab "New chat"', 'tab "alpha.ts"']);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function clickChatNotification(
	app: LaunchedApp,
	opens: Readonly<{ workstreamId: string; sessionId: string }>,
): Promise<void> {
	await app.electronApp.evaluate(({ Notification }) => {
		Notification.prototype.show = function clickWhenShown(
			this: InstanceType<typeof Notification>,
		): void {
			this.emit('click');
		};
	});
	await invoke(app.page, 'app.notify', {
		options: { title: 'Open files workstream finished', body: 'MENTION', opens },
	});
}

async function expectMentionChatShown(page: Page): Promise<void> {
	await expect(chatTab(page, /MENTION/u)).toHaveAttribute('aria-selected', 'true');
	await expect(fileTab(page, 'alpha.ts')).toHaveAttribute('aria-selected', 'false');
	await expect(page.getByRole('tabpanel', { name: 'alpha.ts' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Open beta.ts' })).toBeVisible();
}

test('clicking a chat notification shows that chat, not the file tab opened from it', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const other = await createSourceRepo(app.root, 'other');
		await seedWorkstream(page, other, 'e2e-notified-other-ws', 'Other workstream');
		await workstreamWithMentions(app, 'e2e-notified-chat-ws');
		const sessionId = currentSessionId(page);
		if (!sessionId) throw new Error('the mention chat did not commit a session id');
		const notified = { workstreamId: 'e2e-notified-chat-ws', sessionId };

		await openMention(page, 'alpha.ts');
		await expectShowing(page, 'alpha.ts');
		await clickChatNotification(app, notified);

		await expectMentionChatShown(page);

		await openMention(page, 'alpha.ts');
		await expectShowing(page, 'alpha.ts');
		const otherRow = page.getByTestId('sidebar-workstream').filter({ hasText: 'Other workstream' });
		await otherRow.click();
		await expect(otherRow).toHaveAttribute('aria-current', 'page');
		await expect(fileTab(page, 'alpha.ts')).toHaveCount(0);
		await clickChatNotification(app, notified);

		await expect.poll(() => currentSessionId(page)).toBe(sessionId);
		await expectMentionChatShown(page);
		await page.mouse.move(0, 0);
		await captureFlow(app, 'open-file-11-notified-chat');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('opening a second file replaces the preview tab', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await workstreamWithMentions(app, 'e2e-replace-file-ws');

		await openMention(page, 'alpha.ts');
		await expectShowing(page, 'alpha.ts');
		await openMention(page, 'beta.ts');

		await expectShowing(page, 'beta.ts');
		await expectStrip(page, ['tab /MENTION/', 'tab "beta.ts"']);
		await expect(fileTab(page, 'beta.ts')).toHaveAccessibleDescription('Preview');

		await page.getByRole('treeitem', { name: 'Open gamma.ts' }).click();

		await expectShowing(page, 'gamma.ts');
		await expectStrip(page, ['tab /MENTION/', 'tab "gamma.ts"']);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('double-clicking or pressing Enter on a preview tab keeps it, so the next file opens in a new tab', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await workstreamWithMentions(app, 'e2e-pin-file-ws');

		await openMention(page, 'alpha.ts');
		await expectShowing(page, 'alpha.ts');
		await fileTab(page, 'alpha.ts').dblclick();
		await expect(fileTab(page, 'alpha.ts')).toHaveAccessibleDescription('');

		await openMention(page, 'beta.ts');

		await expectShowing(page, 'beta.ts');
		await expectStrip(page, ['tab /MENTION/', 'tab "beta.ts"', 'tab "alpha.ts"']);
		await expect(fileTab(page, 'beta.ts')).toHaveAccessibleDescription('Preview');

		await openWorkstream(page, 'e2e-pin-file-ws');
		await expectStrip(page, ['tab /MENTION/', 'tab "beta.ts"', 'tab "alpha.ts"']);
		await expectShowing(page, 'beta.ts');

		await fileTab(page, 'beta.ts').focus();
		await page.keyboard.press('Enter');
		await expect(fileTab(page, 'beta.ts')).toHaveAccessibleDescription('');
		await openMention(page, 'gamma.ts');
		await expectShowing(page, 'gamma.ts');
		await expectStrip(page, ['tab /MENTION/', 'tab "gamma.ts"', 'tab "beta.ts"', 'tab "alpha.ts"']);

		await fileTab(page, 'gamma.ts').hover();
		await page.getByRole('button', { name: 'Close gamma.ts' }).click();
		await expectShowing(page, 'beta.ts');
		await expectStrip(page, ['tab /MENTION/', 'tab "beta.ts"', 'tab "alpha.ts"']);

		await page.mouse.move(0, 0);
		await captureFlow(app, 'open-file-3-pinned');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('opening a file that already has a tab focuses that tab', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await workstreamWithMentions(app, 'e2e-focus-file-ws');

		await openMention(page, 'alpha.ts');
		await fileTab(page, 'alpha.ts').dblclick();
		await openMention(page, 'beta.ts');
		await expectShowing(page, 'beta.ts');

		await openMention(page, 'alpha.ts');

		await expectShowing(page, 'alpha.ts');
		await expectStrip(page, ['tab /MENTION/', 'tab "beta.ts"', 'tab "alpha.ts"']);
		await expect(fileTab(page, 'beta.ts')).toHaveAttribute('aria-selected', 'false');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a chat tab is named by its chat and described by its state only while it has one', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await workstreamWithFiles(app, 'e2e-chat-tab-name-ws');
		await sendPrompt(page, 'Name this chat');
		await expectAssistantReply(page);
		const chat = chatTab(page, /Name this chat/u);
		await expect(chat).toHaveAccessibleName('Name this chat');
		await expect(chat).toHaveAccessibleDescription('');

		await sendPrompt(page, 'APPROVAL');
		await expect(chat).toHaveAccessibleDescription('Waiting for approval', { timeout: 20_000 });
		await expect(chat).toHaveAccessibleName('Name this chat');
		await expectStrip(page, ['tab "Name this chat" [selected]']);
		writeFileSync(
			join(CONTEXT_ROOT, 'chat-tab-name-aria-snapshot.txt'),
			`${await strip(page).ariaSnapshot()}\n`,
		);
		await page.mouse.move(0, 0);
		await captureFlow(app, 'chat-tab-name-waiting-for-approval');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the strip is a tab list of tabs only, walked with the arrow keys, with each close button beside its tab', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await workstreamWithMentions(app, 'e2e-tab-keys-ws');
		await openMention(page, 'alpha.ts');
		await fileTab(page, 'alpha.ts').dblclick();
		await openMention(page, 'beta.ts');
		await expectShowing(page, 'beta.ts');
		await page.mouse.move(0, 0);
		await captureFlow(app, 'tab-strip-1-chat-preview-pinned');

		await expectStrip(page, ['tab /MENTION/', 'tab "beta.ts"', 'tab "alpha.ts"']);
		writeFileSync(
			join(CONTEXT_ROOT, 'tab-strip-aria-snapshot.txt'),
			`${await strip(page).ariaSnapshot()}\n`,
		);
		const panelId = await page.getByRole('tabpanel', { name: 'beta.ts' }).getAttribute('id');
		expect(panelId).toBeTruthy();
		await expect(fileTab(page, 'beta.ts')).toHaveAttribute('aria-controls', panelId ?? '');

		const closeBeta = page.getByRole('button', { name: 'Close beta.ts', exact: true });
		const closeAlpha = page.getByRole('button', { name: 'Close alpha.ts', exact: true });
		await closeAlpha.focus();
		await page.keyboard.press('Shift+Tab');
		await expect(closeBeta).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(fileTab(page, 'beta.ts')).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(closeBeta).toBeFocused();
		await page.keyboard.press('Shift+Tab');

		await page.keyboard.press('ArrowRight');
		await expect(fileTab(page, 'alpha.ts')).toBeFocused();
		await page.keyboard.press('ArrowRight');
		await expect(chatTab(page, /MENTION/u)).toBeFocused();
		await page.keyboard.press('ArrowLeft');
		await expect(fileTab(page, 'alpha.ts')).toBeFocused();
		await page.keyboard.press('Home');
		await expect(chatTab(page, /MENTION/u)).toBeFocused();
		await page.keyboard.press('End');
		await expect(fileTab(page, 'alpha.ts')).toBeFocused();
		await expect(fileTab(page, 'beta.ts')).toHaveAttribute('aria-selected', 'true');
		await captureFlow(app, 'tab-strip-2-arrow-focus');

		await page.keyboard.press('Enter');
		await expectShowing(page, 'alpha.ts');
		await expect(fileTab(page, 'alpha.ts')).toBeFocused();

		await page.keyboard.press('Home');
		await page.keyboard.press('Space');
		await expect(chatTab(page, /MENTION/u)).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByRole('tabpanel', { name: 'alpha.ts' })).toHaveCount(0);

		await page.keyboard.press('End');
		await expect(fileTab(page, 'alpha.ts')).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(closeAlpha).toBeFocused();
		await page.keyboard.press('Enter');
		await expectStrip(page, ['tab /MENTION/', 'tab "beta.ts"']);

		await fileTab(page, 'beta.ts').hover();
		await closeBeta.click();
		await expectStrip(page, ['tab /MENTION/']);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('new chats, forks and files open directly after the current tab', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await workstreamWithFiles(app, 'e2e-tab-order-ws');
		await page.getByRole('button', { name: 'Hide sidebar' }).click();
		await sendPrompt(page, 'One MENTION:alpha.ts');
		await expectAssistantReply(page);

		await chatAbout(page, 'Two');
		await expectStrip(page, ['tab /One/', 'tab /Two/']);

		await chatTab(page, /One/u).click();
		await chatAbout(page, 'Three');
		await expectStrip(page, ['tab /One/', 'tab /Three$/', 'tab /Two/']);

		await chatTab(page, /One/u).click();
		await page.getByRole('link', { name: 'Open alpha.ts' }).click();
		await expectShowing(page, 'alpha.ts');
		await expectStrip(page, ['tab /One/', 'tab "alpha.ts"', 'tab /Three$/', 'tab /Two/']);

		await chatTab(page, /Three$/u).click();
		await page.getByRole('button', { name: 'Fork to new chat' }).click();
		await expect(chatTab(page, /New chat$/u)).toHaveAttribute('aria-selected', 'true', {
			timeout: 30_000,
		});
		await expectStrip(page, [
			'tab /One/',
			'tab "alpha.ts"',
			'tab /Three$/',
			'tab /New chat$/',
			'tab /Two/',
		]);
		await sendPrompt(page, 'Four');
		await expectAssistantReply(page);
		await expect(chatTab(page, /Four/u)).toHaveAttribute('aria-selected', 'true', {
			timeout: 30_000,
		});
		await expectStrip(page, [
			'tab /One/',
			'tab "alpha.ts"',
			'tab /Three$/',
			'tab /Four/',
			'tab /Two/',
		]);

		await captureFlow(app, 'open-file-5-tab-order');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('same-name files in different folders are told apart by their path', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await workstreamWithFiles(app, 'e2e-same-name-ws', {
			'app/index.ts': 'export const app = 1;\n',
			'lib/index.ts': 'export const lib = 2;\n',
		});
		await sendPrompt(page, 'MENTION:app/index.ts,lib/index.ts');
		await expectAssistantReply(page);

		await page.getByRole('link', { name: 'Open app/index.ts' }).click();
		await tabRow(page).getByRole('tab', { name: 'index.ts', exact: true }).dblclick();
		await chatTab(page, /MENTION/u).click();
		await page.getByRole('link', { name: 'Open lib/index.ts' }).click();

		const libTab = tabRow(page).getByRole('tab', { name: 'index.ts', exact: true, selected: true });
		await expect(tabRow(page).getByRole('tab', { name: 'index.ts', exact: true })).toHaveCount(2);
		await expect(libTab).toHaveAttribute('aria-selected', 'true');
		await libTab.hover();
		await expect(page.getByRole('tooltip')).toHaveText('lib/index.ts');
		const fileView = page.getByRole('tabpanel', { name: 'index.ts' });
		await expect(
			fileView.getByRole('navigation', { name: 'File path' }).getByRole('listitem'),
		).toHaveText(['lib', 'index.ts']);
		await expect(fileView).toContainText('export const lib = 2;', { timeout: 20_000 });

		await captureFlow(app, 'open-file-6-same-name');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

const NESTED_FILES = {
	'src/git/remote.ts': 'export const remote = 1;\n',
	'packages/agent-bridge/src/tools/registry.test.ts': 'export const registry = 2;\n',
	'packages/a/index.ts': 'export const a = 3;\n',
	'packages/b/index.ts': 'export const b = 4;\n',
	'.github/workflows/ci.yml': 'on: push\n',
} as const;

const HIDDEN_FILE = '.github/workflows/ci.yml';

async function workstreamMentioningNestedFiles(
	app: LaunchedApp,
	workstreamId: string,
	mentions: readonly string[],
): Promise<void> {
	await workstreamWithFiles(app, workstreamId, NESTED_FILES);
	await sendPrompt(app.page, `MENTION:${mentions.join(',')}`);
	await expectAssistantReply(app.page);
}

function treeRow(page: Page, path: string): Locator {
	return page.getByRole('treeitem', { name: `Open ${path}` });
}

test('a file the agent names opens from a bare name or a hidden folder, and the Files tree reveals what it shows', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await workstreamMentioningNestedFiles(app, 'e2e-bare-name-ws', [
			'remote.ts',
			'registry.test.ts:1',
			'ghost.ts',
			HIDDEN_FILE,
		]);
		const reply = page.getByTestId('chat-message-bubble');
		await expect(reply.getByRole('link')).toHaveText([
			'remote.ts',
			'registry.test.ts:1',
			HIDDEN_FILE,
		]);
		await expect(reply).toContainText('and ghost.ts and');
		await expect(treeRow(page, 'src/git/remote.ts')).toHaveCount(0);
		const chat = tabRow(page).getByTestId('chat-agent-tab');

		await page.getByRole('link', { name: 'Open remote.ts' }).click();

		const remoteTab = tabRow(page).getByRole('tab', { name: 'remote.ts', exact: true });
		await expect(remoteTab).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByRole('tabpanel', { name: 'remote.ts' })).toContainText(
			NESTED_FILES['src/git/remote.ts'],
			{ timeout: 20_000 },
		);
		await expect(treeRow(page, 'src/git/remote.ts')).toBeVisible();
		await expect(treeRow(page, 'src/git/remote.ts')).toHaveAttribute('aria-selected', 'true');
		await remoteTab.dblclick();

		await chat.click();
		await page.getByRole('link', { name: 'Open registry.test.ts at line 1' }).click();

		const registry = 'packages/agent-bridge/src/tools/registry.test.ts';
		await expect(
			tabRow(page).getByRole('tab', { name: 'registry.test.ts', exact: true }),
		).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByRole('tabpanel', { name: 'registry.test.ts' })).toContainText(
			NESTED_FILES[registry],
			{ timeout: 20_000 },
		);
		await expect(treeRow(page, registry)).toBeInViewport();
		await expect(page.getByRole('treeitem', { selected: true })).toHaveAccessibleName(
			`Open ${registry}`,
		);

		await chat.click();
		await page.getByRole('link', { name: `Open ${HIDDEN_FILE}` }).click();

		await expect(tabRow(page).getByRole('tab', { name: 'ci.yml', exact: true })).toHaveAttribute(
			'aria-selected',
			'true',
		);
		const hiddenView = page.getByRole('tabpanel', { name: 'ci.yml' });
		await expect(hiddenView).toContainText(NESTED_FILES[HIDDEN_FILE], { timeout: 20_000 });
		await expect(
			hiddenView.getByRole('navigation', { name: 'File path' }).getByRole('listitem'),
		).toHaveText(['.github', 'workflows', 'ci.yml']);
		await expect(page.getByRole('treeitem', { selected: true })).toHaveCount(0);
		await expect(page.getByRole('treeitem', { name: /\.github/u })).toHaveCount(0);
		await page.mouse.move(0, 0);
		await captureFlow(app, 'open-file-10-hidden-file');

		await remoteTab.click();
		await expect(page.getByRole('treeitem', { selected: true })).toHaveAccessibleName(
			'Open src/git/remote.ts',
		);
		await expect(treeRow(page, 'src/git/remote.ts')).toBeInViewport();

		await page.mouse.move(0, 0);
		await captureFlow(app, 'open-file-8-bare-name-reveal');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a name several files share offers a chooser, and the chosen file opens', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await workstreamMentioningNestedFiles(app, 'e2e-ambiguous-name-ws', ['index.ts']);

		await page.getByRole('link', { name: 'Open index.ts' }).click();

		const chooser = page.getByRole('menu', { name: '2 files match index.ts' });
		await expect(chooser).toMatchAriaSnapshot(
			[
				'- menu "2 files match index.ts":',
				'  - menuitem "packages/a/index.ts"',
				'  - menuitem "packages/b/index.ts"',
			].join('\n'),
		);
		await expect(chooser.getByRole('menuitem')).toHaveCount(2);
		await expect(tabRow(page).getByRole('tab', { name: 'index.ts', exact: true })).toHaveCount(0);
		await page.mouse.move(0, 0);
		await captureFlow(app, 'open-file-9-ambiguous-chooser');

		await chooser.getByRole('menuitem', { name: 'packages/b/index.ts' }).click();

		await expect(chooser).toHaveCount(0);
		await expect(tabRow(page).getByRole('tab', { name: 'index.ts', exact: true })).toHaveAttribute(
			'aria-selected',
			'true',
		);
		await expect(page.getByRole('tabpanel', { name: 'index.ts' })).toContainText(
			NESTED_FILES['packages/b/index.ts'],
			{ timeout: 20_000 },
		);
		await expect(treeRow(page, 'packages/b/index.ts')).toHaveAttribute('aria-selected', 'true');

		await chatTab(page, /MENTION/u).click();
		await page.getByRole('link', { name: 'Open index.ts' }).focus();
		await page.keyboard.press('Enter');
		await expect(chooser).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(chooser).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Open index.ts' })).toBeFocused();

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('kept files overflow into the more menu instead of pushing the strip off screen', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const names = Array.from(
			{ length: 14 },
			(_, index) => `module-${String(index + 1).padStart(2, '0')}-overflow.ts`,
		);
		await workstreamWithFiles(
			app,
			'e2e-overflow-ws',
			Object.fromEntries(names.map((name) => [name, `export const value = '${name}';\n`])),
		);
		for (const name of names) {
			await page.getByRole('treeitem', { name: `Open ${name}` }).click();
			const tab = tabRow(page).getByRole('tab', { name, exact: true });
			await expect(tab).toHaveAttribute('aria-selected', 'true');
			await tab.dblclick();
		}

		const more = page.getByTestId('chat-agent-overflow');
		await expect(more).toHaveAccessibleName(/^\d+ more chats and files$/u);
		await expect(more).toBeVisible();
		const startChat = startChatButton(page);
		await expect(startChat).toBeVisible();
		await expectOnlyTabs(page);
		const moreBox = await more.boundingBox();
		const startChatBox = await startChat.boundingBox();
		if (!moreBox || !startChatBox) throw new Error('the strip controls are not on screen');
		expect(startChatBox.x).toBeGreaterThanOrEqual(moreBox.x + moreBox.width);
		const stripBox = await strip(page).boundingBox();
		if (!stripBox) throw new Error('the tab strip is not on screen');
		for (const box of await tabRow(page)
			.getByRole('tab')
			.evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().right))) {
			expect(box).toBeLessThanOrEqual(stripBox.x + stripBox.width + 1);
		}
		const lastName = names.at(-1) ?? '';
		const hiddenName = names.at(-2) ?? '';
		await expect(tabRow(page).getByRole('tab', { name: lastName, exact: true })).toHaveAttribute(
			'aria-selected',
			'true',
		);
		await expect(tabRow(page).getByRole('tab', { name: hiddenName, exact: true })).toHaveCount(0);

		await more.click();
		await page.getByRole('menuitem', { name: new RegExp(hiddenName, 'u') }).click();
		await expect(tabRow(page).getByRole('tab', { name: hiddenName, exact: true })).toHaveAttribute(
			'aria-selected',
			'true',
		);
		await expect(page.getByRole('tabpanel', { name: hiddenName })).toContainText(hiddenName, {
			timeout: 20_000,
		});
		const shownInTree = page.getByRole('treeitem', { selected: true });
		await expect(shownInTree).toHaveAccessibleName(`Open ${hiddenName}`);

		await page.mouse.move(0, 0);
		await captureFlow(app, 'open-file-7-overflow');

		const moreMenu = page.getByRole('menu', { name: 'More chats and files' });
		await page.keyboard.press('ControlOrMeta+k');
		await expect(moreMenu).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(moreMenu).toHaveCount(0);

		const firstName = names[0] ?? '';
		await tabRow(page).getByRole('tab', { name: firstName, exact: true }).click();
		await expect(shownInTree).toHaveAccessibleName(`Open ${firstName}`);
		await tabRow(page).getByRole('tab', { name: 'New chat', exact: true }).click();
		await expect(page.getByRole('treeitem', { selected: true })).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('tabs shrink to share the strip, and hovering a shrunk tab reveals its whole name', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const names = Array.from(
			{ length: 4 },
			(_, index) => `shared-workspace-configuration-${index + 1}.ts`,
		);
		await workstreamWithFiles(
			app,
			'e2e-shrink-ws',
			Object.fromEntries(names.map((name) => [name, `export const value = '${name}';\n`])),
		);
		for (const name of names) {
			await page.getByRole('treeitem', { name: `Open ${name}` }).click();
			const tab = tabRow(page).getByRole('tab', { name, exact: true });
			await expect(tab).toHaveAttribute('aria-selected', 'true');
			await tab.dblclick();
		}

		await expect(page.getByTestId('chat-agent-overflow')).toHaveCount(0);
		const stripBox = await strip(page).boundingBox();
		if (!stripBox) throw new Error('the tab strip is not on screen');
		for (const name of names) {
			const box = await tabRow(page).getByRole('tab', { name, exact: true }).boundingBox();
			expect(box?.x ?? -1).toBeGreaterThanOrEqual(stripBox.x);
			expect((box?.x ?? Infinity) + (box?.width ?? 0)).toBeLessThanOrEqual(
				stripBox.x + stripBox.width + 1,
			);
		}

		const first = tabRow(page).getByRole('tab', { name: names[0] ?? '', exact: true });
		const nameEndPastTab = (): Promise<number> =>
			first.evaluate((tab) => {
				const range = tab.ownerDocument.createRange();
				range.selectNodeContents(tab);
				return range.getBoundingClientRect().right - tab.getBoundingClientRect().right;
			});
		expect(await nameEndPastTab()).toBeGreaterThan(0);
		await first.hover();
		await expect.poll(nameEndPastTab).toBeLessThan(0);

		await page.mouse.move(0, 0);
		await captureFlow(app, 'open-file-8-shrink');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
