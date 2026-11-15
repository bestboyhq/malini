import { expect, test, type Page } from '@playwright/test';
import {
	createSourceRepo,
	currentSessionId,
	expectCleanConsole,
	expectPicker,
	invoke,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	settleAnimations,
	showInspector,
	type LaunchedApp,
} from './harness';

declare global {
	var chromeMenuPopUps: { x: number | undefined; y: number | undefined }[];
	var chromeMenusShown: number;
	var chromeMenusClosed: number;
	var chromeTints: Electron.TitleBarOverlayOptions[];
	var chromeFoldersAsked: number;
}

type Box = Readonly<{
	left: number;
	right: number;
	top: number;
	bottom: number;
	width: number;
	height: number;
}>;

type Control = Readonly<{
	tagName: string;
	textContent: string | null;
	getAttribute(name: string): string | null;
	getBoundingClientRect(): Box;
	checkVisibility(options: Readonly<{ opacityProperty: true; visibilityProperty: true }>): boolean;
}>;

type AppWindow = Readonly<{
	innerWidth: number;
	navigator: Readonly<{
		windowControlsOverlay: Readonly<{ visible: boolean; getTitlebarAreaRect(): Box }>;
	}>;
	document: Readonly<{ querySelectorAll(selectors: string): Iterable<Control> }>;
}>;

const OS_DRAWS_THE_CONTROLS = process.platform !== 'darwin';
const MAC_ONLY = 'macOS keeps its own menu bar and traffic lights';
const A_GLANCE_AT_THE_MENU_MS = 500;

type Modifier = 'control' | 'shift';

function openedWorkstreamId(page: Page): string | null {
	return /#\/workstreams\/([^?/]+)/u.exec(page.url())?.[1] ?? null;
}

async function press(
	app: LaunchedApp,
	keyCode: string,
	modifiers: readonly Modifier[] = ['control'],
): Promise<void> {
	await app.electronApp.evaluate(
		({ BrowserWindow }, key) => {
			const [main] = BrowserWindow.getAllWindows();
			if (!main) throw new Error('malini opened no window');
			for (const type of ['keyDown', 'keyUp'] as const) {
				main.webContents.sendInputEvent({ type, keyCode: key.keyCode, modifiers: key.modifiers });
			}
		},
		{ keyCode, modifiers: [...modifiers] },
	);
}

async function focusTheWindow(app: LaunchedApp): Promise<void> {
	const focused = (): Promise<boolean> =>
		app.electronApp.evaluate(({ BrowserWindow }) => {
			const [main] = BrowserWindow.getAllWindows();
			if (!main) throw new Error('malini opened no window');
			BrowserWindow.prototype.focus.call(main);
			return main.isFocused();
		});
	await expect
		.poll(focused, { message: 'a shortcut reaches the menu only in the focused window' })
		.toBe(true);
}

function zoomFactor(app: LaunchedApp): Promise<number> {
	return app.electronApp.evaluate(
		({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor() ?? 0,
	);
}

function innerWidth(page: Page): Promise<number> {
	return page.locator('body').evaluate((body) => {
		const view: AppWindow = body.ownerDocument.defaultView;
		return view.innerWidth;
	});
}

function overlayShown(page: Page): Promise<boolean> {
	return page.locator('body').evaluate((body) => {
		const view: AppWindow = body.ownerDocument.defaultView;
		return view.navigator.windowControlsOverlay.visible;
	});
}

async function controlsUnderTheWindowControls(page: Page): Promise<string[]> {
	await settleAnimations(page);
	return page.locator('body').evaluate((body) => {
		const view: AppWindow = body.ownerDocument.defaultView;
		const area = view.navigator.windowControlsOverlay.getTitlebarAreaRect();
		const captions = [
			{ left: 0, right: area.left, bottom: area.bottom },
			{ left: area.right, right: view.innerWidth, bottom: area.bottom },
		].filter((caption) => caption.right > caption.left && caption.bottom > 0);
		const controls = view.document.querySelectorAll(
			'button, a[href], input, textarea, select, [role="button"], [role="tab"], [role="link"], [role="menuitem"], [role="status"]',
		);
		return [...controls].flatMap((control) => {
			const box = control.getBoundingClientRect();
			const shown =
				box.width > 1 &&
				box.height > 1 &&
				control.checkVisibility({ opacityProperty: true, visibilityProperty: true });
			const covered = captions.some(
				(caption) =>
					box.left < caption.right &&
					box.right > caption.left &&
					box.top < caption.bottom &&
					box.bottom > 0,
			);
			const name = control.getAttribute('aria-label') ?? control.textContent?.trim();
			return shown && covered ? [name || control.tagName] : [];
		});
	});
}

test('the window shows once its page paints, and only Windows and Linux draw the window controls over the top bar with a Menu button', async () => {
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		await expectPicker(page);
		await expect
			.poll(() =>
				electronApp.evaluate(
					({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false,
				),
			)
			.toBe(true);
		expect(await overlayShown(page)).toBe(OS_DRAWS_THE_CONTROLS);
		await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveCount(
			OS_DRAWS_THE_CONTROLS ? 1 : 0,
		);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the Menu button, and Alt pressed alone, pop up the application menu under the button', async () => {
	test.skip(!OS_DRAWS_THE_CONTROLS, MAC_ONLY);
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		await expectPicker(page);
		await electronApp.evaluate(({ Menu }) => {
			const menu = Menu.getApplicationMenu();
			if (!menu) throw new Error('malini set no application menu');
			globalThis.chromeMenuPopUps = [];
			globalThis.chromeMenusShown = 0;
			globalThis.chromeMenusClosed = 0;
			const popUp = menu.popup.bind(menu);
			menu.popup = (options) => {
				globalThis.chromeMenuPopUps.push({ x: options?.x, y: options?.y });
				popUp(options);
			};
			menu.on('menu-will-show', () => {
				globalThis.chromeMenusShown += 1;
			});
			menu.on('menu-will-close', () => {
				globalThis.chromeMenusClosed += 1;
			});
		});
		const menus = (): Promise<{ shown: number; closed: number }> =>
			electronApp.evaluate(() => ({
				shown: globalThis.chromeMenusShown,
				closed: globalThis.chromeMenusClosed,
			}));
		const staysOpenUntilDismissed = async (popUps: number): Promise<void> => {
			const open = { shown: popUps, closed: popUps - 1 };
			await expect.poll(menus).toEqual(open);
			await page.waitForTimeout(A_GLANCE_AT_THE_MENU_MS);
			expect(await menus(), 'the menu stays open until it is dismissed').toEqual(open);
			await electronApp.evaluate(({ BrowserWindow, Menu }) => {
				const [main] = BrowserWindow.getAllWindows();
				if (main) Menu.getApplicationMenu()?.closePopup(main);
			});
			await expect.poll(menus).toEqual({ shown: popUps, closed: popUps });
		};

		const button = page.getByRole('button', { name: 'Menu', exact: true });
		await expect(button).toHaveAttribute('aria-haspopup', 'menu');
		await button.click();
		await expect.poll(menus).toEqual({ shown: 1, closed: 0 });
		const box = await button.boundingBox();
		if (!box) throw new Error('the Menu button has no box');
		const [at] = await electronApp.evaluate(() => globalThis.chromeMenuPopUps);
		expect(at?.x).toBe(Math.round(box.x));
		expect(at?.y).toBeGreaterThan(box.y + box.height);
		await staysOpenUntilDismissed(1);

		await page.keyboard.press('Alt');
		await staysOpenUntilDismissed(2);

		await page.keyboard.press('Alt+KeyF');
		await page.keyboard.press('Control+Alt');
		await invoke(page, 'app.runtime-info', undefined);
		expect(await electronApp.evaluate(() => globalThis.chromeMenuPopUps.length)).toBe(2);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the menu shortcuts work while the menu bar stays hidden', async () => {
	test.skip(!OS_DRAWS_THE_CONTROLS, MAC_ONLY);
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const source = await createSourceRepo(app.root, 'alpha');
		await seedWorkstream(page, source, 'e2e-chrome', 'Chrome');
		await openWorkstream(page, 'e2e-chrome');
		expect(
			await electronApp.evaluate(
				({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMenuBarVisible() ?? true,
			),
		).toBe(false);
		await focusTheWindow(app);

		await press(app, ',');
		const settings = page.getByRole('dialog', { name: 'Settings' });
		await expect(settings).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(settings).toHaveCount(0);

		const previousChat = currentSessionId(page);
		await press(app, 't');
		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).not.toBe(previousChat);
		await expect(page.getByTestId('chat-fresh-session')).toBeVisible({ timeout: 20_000 });

		const composer = page.getByTestId('chat-composer-input');
		await composer.click();
		await page.keyboard.type('first draft');
		await press(app, 'a');
		await page.keyboard.type('second draft');
		await expect(composer).toHaveText('second draft');

		const unzoomed = await zoomFactor(app);
		await press(app, '=');
		await expect.poll(() => zoomFactor(app)).toBeGreaterThan(unzoomed);
		await press(app, '-');
		await expect.poll(() => zoomFactor(app)).toBe(unzoomed);
		await press(app, '=', ['control', 'shift']);
		await expect.poll(() => zoomFactor(app)).toBeGreaterThan(unzoomed);
		await press(app, '0');
		await expect.poll(() => zoomFactor(app)).toBe(unzoomed);

		await electronApp.evaluate(({ dialog }) => {
			globalThis.chromeFoldersAsked = 0;
			dialog.showOpenDialog = async () => {
				globalThis.chromeFoldersAsked += 1;
				return { canceled: true, filePaths: [] };
			};
		});
		await press(app, 'o');
		await expect.poll(() => electronApp.evaluate(() => globalThis.chromeFoldersAsked)).toBe(1);

		await press(app, 'n');
		await expect.poll(() => openedWorkstreamId(page), { timeout: 20_000 }).not.toBe('e2e-chrome');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('no control sits under the window controls, with the sidebar or the inspector open, or the window at its narrowest', async () => {
	test.skip(!OS_DRAWS_THE_CONTROLS, MAC_ONLY);
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		await expectPicker(page);
		expect(await controlsUnderTheWindowControls(page), 'the repository picker').toEqual([]);

		const source = await createSourceRepo(app.root, 'alpha');
		await seedWorkstream(page, source, 'e2e-chrome', 'Chrome');
		await openWorkstream(page, 'e2e-chrome');
		expect(await controlsUnderTheWindowControls(page), 'a workstream').toEqual([]);

		await showInspector(page);
		expect(await controlsUnderTheWindowControls(page), 'the inspector').toEqual([]);

		await page.getByRole('button', { name: 'Hide sidebar' }).click();
		await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible();
		expect(await controlsUnderTheWindowControls(page), 'the sidebar hidden').toEqual([]);

		const wide = await innerWidth(page);
		await electronApp.evaluate(({ BrowserWindow }) => {
			const [main] = BrowserWindow.getAllWindows();
			if (!main) throw new Error('malini opened no window');
			const [narrowest = 0] = main.getMinimumSize();
			main.setSize(narrowest, main.getSize()[1] ?? 800);
		});
		await expect.poll(() => innerWidth(page)).toBeLessThan(wide);
		expect(await controlsUnderTheWindowControls(page), 'the narrowest window').toEqual([]);

		await page.getByRole('button', { name: 'Show sidebar' }).click();
		await expect(page.getByRole('button', { name: 'Hide sidebar' })).toBeVisible();
		expect(
			await controlsUnderTheWindowControls(page),
			'the narrowest window with the sidebar',
		).toEqual([]);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the window controls change with the theme and come back the same', async () => {
	test.skip(!OS_DRAWS_THE_CONTROLS, MAC_ONLY);
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		await expectPicker(page);
		await page.emulateMedia({ colorScheme: 'dark' });
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		await electronApp.evaluate(({ BrowserWindow }) => {
			const [main] = BrowserWindow.getAllWindows();
			if (!main) throw new Error('malini opened no window');
			globalThis.chromeTints = [];
			const tint = main.setTitleBarOverlay.bind(main);
			main.setTitleBarOverlay = (options) => {
				globalThis.chromeTints.push(options);
				tint(options);
			};
		});
		const tints = (): Promise<Electron.TitleBarOverlayOptions[]> =>
			electronApp.evaluate(() => globalThis.chromeTints);

		await page.emulateMedia({ colorScheme: 'light' });
		await expect.poll(async () => (await tints()).length).toBe(1);
		await page.emulateMedia({ colorScheme: 'dark' });
		await expect.poll(async () => (await tints()).length).toBe(2);
		await page.emulateMedia({ colorScheme: 'light' });
		await expect.poll(async () => (await tints()).length).toBe(3);

		const [light, dark, lightAgain] = await tints();
		expect(dark).not.toEqual(light);
		expect(lightAgain).toEqual(light);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
