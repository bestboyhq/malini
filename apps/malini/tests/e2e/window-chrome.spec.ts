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
	var chromeFoldersAsked: number;
	var chromePresses: string[];
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
	closest(selectors: string): Control | null;
	textContent: string | null;
	getAttribute(name: string): string | null;
	getBoundingClientRect(): Box;
	checkVisibility(options: Readonly<{ opacityProperty: true; visibilityProperty: true }>): boolean;
}>;

type AppWindow = Readonly<{
	innerWidth: number;
	navigator: Readonly<{ windowControlsOverlay: Readonly<{ visible: boolean }> }>;
	document: Readonly<{
		querySelector(selectors: string): Control | null;
		querySelectorAll(selectors: string): Iterable<Control>;
	}>;
}>;

const MALINI_DRAWS_THE_CONTROLS = process.platform !== 'darwin';
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
		const WINDOW_CONTROLS = '[data-testid="window-controls"]';
		const lights = view.document.querySelector(WINDOW_CONTROLS);
		if (!lights) throw new Error('malini drew no window controls');
		const area = lights.getBoundingClientRect();
		const controls = view.document.querySelectorAll(
			'button, a[href], input, textarea, select, [role="button"], [role="tab"], [role="link"], [role="menuitem"], [role="status"]',
		);
		return [...controls].flatMap((control) => {
			if (control.closest(WINDOW_CONTROLS)) return [];
			const box = control.getBoundingClientRect();
			const shown =
				box.width > 1 &&
				box.height > 1 &&
				control.checkVisibility({ opacityProperty: true, visibilityProperty: true });
			const covered =
				box.left < area.right &&
				box.right > area.left &&
				box.top < area.bottom &&
				box.bottom > area.top;
			const name = control.getAttribute('aria-label') ?? control.textContent?.trim();
			return shown && covered ? [name || control.tagName] : [];
		});
	});
}

function windowControl(page: Page, name: string) {
	return page.getByTestId('window-controls').getByRole('button', { name, exact: true });
}

test('the window shows once its page paints, with no overlay, and only on Windows and Linux does Malini draw the window controls and a Menu button', async () => {
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
		expect(await overlayShown(page)).toBe(false);
		for (const name of ['Close', 'Minimize', 'Maximize']) {
			await expect(windowControl(page, name)).toHaveCount(MALINI_DRAWS_THE_CONTROLS ? 1 : 0);
		}
		await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveCount(
			MALINI_DRAWS_THE_CONTROLS ? 1 : 0,
		);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the Menu button, and Alt pressed alone, pop up the application menu under the button', async () => {
	test.skip(!MALINI_DRAWS_THE_CONTROLS, MAC_ONLY);
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

test('the window controls close, minimize, maximize and restore the window, and leave the focus where it was', async () => {
	test.skip(!MALINI_DRAWS_THE_CONTROLS, MAC_ONLY);
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		await expectPicker(page);
		await electronApp.evaluate(({ BrowserWindow }) => {
			const [main] = BrowserWindow.getAllWindows();
			if (!main) throw new Error('malini opened no window');
			globalThis.chromePresses = [];
			for (const control of ['close', 'minimize', 'maximize', 'unmaximize'] as const) {
				main[control] = () => {
					globalThis.chromePresses.push(control);
				};
			}
		});
		const presses = (): Promise<string[]> => electronApp.evaluate(() => globalThis.chromePresses);
		const announce = (event: 'maximize' | 'unmaximize'): Promise<void> =>
			electronApp.evaluate(({ BrowserWindow }, name) => {
				BrowserWindow.getAllWindows()[0]?.emit(name);
			}, event);

		const focused = page.getByRole('button', { name: 'Menu', exact: true });
		await focused.focus();
		await windowControl(page, 'Minimize').click();
		await expect.poll(presses).toEqual(['minimize']);
		await expect(focused).toBeFocused();

		await windowControl(page, 'Maximize').click();
		await expect.poll(presses).toEqual(['minimize', 'maximize']);
		await announce('maximize');
		await expect(windowControl(page, 'Maximize')).toHaveCount(0);
		await windowControl(page, 'Restore').click();
		await expect.poll(presses).toEqual(['minimize', 'maximize', 'unmaximize']);
		await announce('unmaximize');
		await expect(windowControl(page, 'Maximize')).toHaveCount(1);

		await windowControl(page, 'Close').click();
		await expect.poll(presses).toEqual(['minimize', 'maximize', 'unmaximize', 'close']);
		await expect(focused).toBeFocused();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the menu shortcuts work while the menu bar stays hidden', async () => {
	test.skip(!MALINI_DRAWS_THE_CONTROLS, MAC_ONLY);
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
	test.skip(!MALINI_DRAWS_THE_CONTROLS, MAC_ONLY);
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
