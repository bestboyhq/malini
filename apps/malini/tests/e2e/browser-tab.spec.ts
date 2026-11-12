import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createServer as createViteServer } from 'vite';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	invoke,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	settleAnimations,
	showInspector,
	temporaryRoot,
} from './harness';

type PageInput =
	| {
			type: 'mouseMove' | 'mouseDown' | 'mouseUp';
			x: number;
			y: number;
			button?: 'left';
			clickCount?: number;
	  }
	| { type: 'char' | 'keyDown' | 'keyUp'; keyCode: string };

interface WebPage {
	inPage(code: string): Promise<unknown>;
	input(events: readonly PageInput[]): Promise<void>;
	clickAt(element: string): Promise<void>;
}

const PINS = `document.querySelector('malini-pins')?.shadowRoot`;

function webPage(electronApp: ElectronApplication, origin: string): WebPage {
	const inPage = (code: string): Promise<unknown> =>
		electronApp.evaluate(
			({ webContents }, { code, origin }) =>
				webContents
					.getAllWebContents()
					.find((contents) => contents.getURL().startsWith(origin))
					?.executeJavaScript(code),
			{ code, origin },
		);
	const input = (events: readonly PageInput[]): Promise<void> =>
		electronApp.evaluate(
			async ({ webContents }, { events, origin }) => {
				const contents = webContents
					.getAllWebContents()
					.find((candidate) => candidate.getURL().startsWith(origin));
				if (!contents) throw new Error(`no page at ${origin}`);
				for (const event of events) {
					contents.sendInputEvent(event);
					await new Promise((resolve) => setTimeout(resolve, 20));
				}
			},
			{ events, origin },
		);
	const clickAt = async (element: string): Promise<void> => {
		const point = (await inPage(`(() => {
			const box = (${element}).getBoundingClientRect();
			return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
		})()`)) as { x: number; y: number };
		await input([
			{ type: 'mouseMove', ...point },
			{ type: 'mouseDown', ...point, button: 'left', clickCount: 1 },
			{ type: 'mouseUp', ...point, button: 'left', clickCount: 1 },
		]);
	};
	return { inPage, input, clickAt };
}

async function askAboutElement(
	page: Page,
	web: WebPage,
	selector: string,
	prompt: string,
): Promise<void> {
	await expect.poll(() => web.inPage('document.readyState')).toBe('complete');
	const pick = page.getByRole('button', { name: 'Pick an element', exact: true });
	await expect(pick).toBeEnabled();
	await pick.click();
	await expect(pick).toHaveAttribute('aria-pressed', 'true');
	await expect
		.poll(() => web.inPage(`Boolean(document.querySelector('malini-picker'))`))
		.toBe(true);
	await web.clickAt(`document.querySelector(${JSON.stringify(selector)})`);
	await expect
		.poll(() =>
			web.inPage(
				`document.querySelector('malini-picker').shadowRoot.activeElement?.getAttribute('aria-label')`,
			),
		)
		.toBe('Prompt');
	await web.input([...prompt].map((keyCode) => ({ type: 'char' as const, keyCode })));
	await web.input([
		{ type: 'keyDown', keyCode: 'Enter' },
		{ type: 'char', keyCode: '\r' },
		{ type: 'keyUp', keyCode: 'Enter' },
	]);
	await expect
		.poll(() => web.inPage(`${PINS}?.querySelector('button.pin')?.getAttribute('aria-label')`), {
			timeout: 30_000,
		})
		.toBe(`Thread: ${prompt} · Done`);
}

async function openTab(page: Page, origin: string, path: string): Promise<void> {
	await page.getByRole('button', { name: 'Open inspector panel' }).click();
	await page.getByRole('menuitem', { name: 'Browser', exact: true }).click();
	const address = page.getByRole('textbox', { name: 'Page address' }).last();
	await address.fill(`${origin}${path}`);
	await address.press('Enter');
}

async function agentBrowser(
	page: Page,
	request: { readonly action: string } & Record<string, unknown>,
	answer: string | RegExp,
): Promise<void> {
	const encoded = Buffer.from(JSON.stringify(request)).toString('base64url');
	const answers = page.getByText(answer);
	const before = await answers.count();
	await sendPrompt(page, `Browser ${request.action} BROWSER_REQUEST:${encoded}`);
	try {
		await expect(answers).toHaveCount(before + 1, { timeout: 20_000 });
	} catch (error) {
		const last = await page.locator('pre').last().textContent();
		throw new Error(`The browser answered ${request.action} with: ${last}`, { cause: error });
	}
}

async function untilBrowserEventsArrive(page: Page, workstreamId: string): Promise<void> {
	await invoke(page, 'browser.state', { workstreamId, tabId: 'round-trip' });
}

test('browser tabs show only once opened, each with its own page and close button, keep the inspector width on every tab, and closing one closes only its page', async () => {
	test.setTimeout(120_000);
	const server = createServer((request, response) => {
		const title = request.url === '/music' ? 'Lobby music' : 'Served page';
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end(`<!doctype html><title>${title}</title><h1>${title}</h1>`);
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const webPages = () =>
			electronApp.evaluate(({ webContents }) =>
				webContents
					.getAllWebContents()
					.map((contents) => contents.getURL())
					.filter((url) => url.startsWith('http'))
					.sort(),
			);
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-browser-tab-ws', 'Browser tab');
		await openWorkstream(page, seeded.workstreamId);
		await showInspector(page);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });
		await expect(inspector.getByRole('tab')).toHaveCount(1);

		await openTab(page, origin, '/');
		await expect(inspector.getByRole('tab', { name: 'Served page' })).toBeVisible();
		await openTab(page, origin, '/music');
		await expect(inspector.getByRole('tab', { name: 'Lobby music', selected: true })).toBeVisible();
		await expect.poll(webPages).toEqual([`${origin}/`, `${origin}/music`]);

		const split = page.getByRole('separator', { name: 'Resize workstream-transcript' });
		const browserWidth = await split.getAttribute('aria-valuenow');
		await inspector.getByRole('tab', { name: 'Files' }).click();
		await expect(inspector.getByRole('tab', { name: 'Files', selected: true })).toBeVisible();
		await expect(split).toHaveAttribute('aria-valuenow', browserWidth ?? '');
		await expect(page.getByRole('button', { name: 'Close Files', exact: true })).toHaveCount(1);
		await expect(page.getByRole('button', { name: 'Close Lobby music', exact: true })).toHaveCount(
			1,
		);

		await inspector.getByRole('tab', { name: 'Served page' }).hover();
		await page.getByRole('button', { name: 'Close Served page', exact: true }).click();
		await expect(inspector.getByRole('tab', { name: 'Served page' })).toHaveCount(0);
		await expect.poll(webPages).toEqual([`${origin}/music`]);
		await expect(inspector.getByRole('tab', { name: 'Lobby music' })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});

test('a new browser tab scrolls the inspector tabs until all of it shows, also once its title widens it', async () => {
	test.setTimeout(120_000);
	const server = createServer((request, response) => {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end(`<!doctype html><title>Served page ${request.url}</title><h1>${request.url}</h1>`);
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-browser-tab-strip-ws', 'Tab strip');
		await openWorkstream(page, seeded.workstreamId);
		await showInspector(page);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });

		for (const path of ['/first', '/second', '/third', '/fourth', '/fifth', '/sixth']) {
			await openTab(page, origin, path);
			await expect(
				inspector.getByRole('tab', { name: `Served page ${path}`, selected: true }),
			).toBeInViewport({ ratio: 0.99 });
		}
		await expect(inspector.getByRole('tab', { name: 'Files' })).not.toBeInViewport({ ratio: 1 });
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});

test('a browser tab says why its page did not load, hides the page meanwhile, and shows it once a reload reaches the server', async () => {
	test.setTimeout(120_000);
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end('<!doctype html><title>Late server</title><h1>Up</h1>');
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	await new Promise<void>((resolve) => server.close(() => resolve()));
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const pageShown = () =>
			electronApp.evaluate(({ BrowserWindow }) =>
				(BrowserWindow.getAllWindows()[0]?.contentView.children ?? []).some((view) =>
					view.getVisible(),
				),
			);
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-failed-ws',
			'Browser failed',
		);
		await openWorkstream(page, seeded.workstreamId);
		await showInspector(page);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });

		await openTab(page, origin, '/');
		const status = inspector.getByRole('status');
		await expect(status).toContainText(`Could not open ${new URL(origin).host}`);
		await expect(status).toContainText('ERR_CONNECTION_REFUSED');
		await expect.poll(pageShown).toBe(false);
		const pick = page.getByRole('button', { name: 'Pick an element' });
		await expect(pick).toBeDisabled();

		await new Promise<void>((resolve) =>
			server.listen(Number(new URL(origin).port), 'localhost', resolve),
		);
		await page.getByRole('button', { name: 'Reload' }).click();
		await expect(inspector.getByRole('tab', { name: 'Late server' })).toBeVisible();
		await expect(status).toHaveCount(0);
		await expect.poll(pageShown).toBe(true);
		await expect(pick).toBeEnabled();
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});

test('a browser tab opens files of its worktree, shows their latest edit on reload, and follows their links without a server', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-browser-file-ws', 'Browser file');
		mkdirSync(join(seeded.worktree, 'docs'), { recursive: true });
		writeFileSync(
			join(seeded.worktree, 'docs', 'report.html'),
			'<!doctype html><script src="title.js"></script><a href="next.html">Next</a>',
		);
		writeFileSync(join(seeded.worktree, 'docs', 'title.js'), 'document.title = "Report";');
		writeFileSync(join(seeded.worktree, 'docs', 'next.html'), '<!doctype html><title>Next</title>');
		await openWorkstream(page, seeded.workstreamId);
		await showInspector(page);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });

		await openTab(page, '', './docs/report.html');
		await expect(inspector.getByRole('tab', { name: 'Report', exact: true })).toBeVisible();
		await expect(page.getByRole('textbox', { name: 'Page address' }).last()).toHaveValue(
			'./docs/report.html',
		);

		writeFileSync(join(seeded.worktree, 'docs', 'title.js'), 'document.title = "Report edited";');
		await electronApp.evaluate(({ webContents }) => {
			webContents
				.getAllWebContents()
				.find((contents) => contents.getTitle() === 'Report')
				?.reload();
		});
		await expect(inspector.getByRole('tab', { name: 'Report edited', exact: true })).toBeVisible();

		await electronApp.evaluate(async ({ webContents }) => {
			const report = webContents
				.getAllWebContents()
				.find((contents) => contents.getTitle() === 'Report edited');
			await report?.executeJavaScript('document.querySelector("a").click()');
		});
		await expect(inspector.getByRole('tab', { name: 'Next', exact: true })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a new browser tab takes the cursor and explains itself, keeps its page under the menus, picks only while pressed, and reopens its page after a restart', async () => {
	test.setTimeout(180_000);
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end('<!doctype html><title>Admin</title><button>Save</button>');
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	const first = await launchMalini();
	let workstreamId = '';
	try {
		const { page, electronApp } = first;
		const pageShown = () =>
			electronApp.evaluate(({ BrowserWindow }) =>
				(BrowserWindow.getAllWindows()[0]?.contentView.children ?? []).some((view) =>
					view.getVisible(),
				),
			);
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(first.root),
			'e2e-browser-restart-ws',
			'Browser restart',
		);
		workstreamId = seeded.workstreamId;
		await openWorkstream(page, workstreamId);
		await showInspector(page);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });

		await page.getByRole('button', { name: 'Open inspector panel' }).click();
		await page.getByRole('menuitem', { name: 'Browser', exact: true }).click();
		const address = page.getByRole('textbox', { name: 'Page address' });
		await expect(address).toBeFocused();
		await expect(inspector.getByText('Open a page')).toBeVisible();
		await expect(
			inspector.getByText('Type a URL above, or ask the agent to open your dev server.'),
		).toBeVisible();

		await address.fill(`${origin}/admin`);
		await address.press('Enter');
		await expect(inspector.getByRole('tab', { name: 'Admin', selected: true })).toBeVisible();
		await expect(inspector.getByText('Open a page')).toHaveCount(0);
		await expect.poll(pageShown).toBe(true);

		await page.getByRole('button', { name: 'Open inspector panel' }).click();
		await expect(page.getByRole('menuitem', { name: 'Browser', exact: true })).toBeVisible();
		await expect.poll(pageShown).toBe(false);
		await settleAnimations(page);
		const menuHeading = page
			.getByTestId('extension-inspector-panel-picker')
			.getByText('Open panel');
		expect(
			await menuHeading.evaluate((heading) => {
				const box = heading.getBoundingClientRect();
				const hit = heading.ownerDocument.elementFromPoint(
					box.x + box.width / 2,
					box.y + box.height / 2,
				);
				return (
					hit !== null &&
					heading.contains(hit) &&
					heading.closest('[role="menu"]')?.getAnimations().length === 0
				);
			}),
		).toBe(true);
		await captureFlow(first, 'browser-tab-still-under-menu');
		await page.keyboard.press('Escape');
		await expect.poll(pageShown).toBe(true);

		const pick = page.getByRole('button', { name: 'Pick an element' });
		await expect(pick).toBeEnabled();
		await expect(pick).toHaveAttribute('aria-pressed', 'false');
		await pick.click();
		await expect(pick).toHaveAttribute('aria-pressed', 'true');
		await pick.click();
		await expect(pick).toHaveAttribute('aria-pressed', 'false');
		expectCleanConsole(first);
		await first.quit();
	} catch (error) {
		await first.close();
		server.close();
		throw error;
	}

	const app = await launchMalini({ profile: first.root });
	try {
		const { page } = app;
		await openWorkstream(page, workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await inspector.getByRole('tab', { name: 'Admin' }).click();
		await expect(page.getByRole('textbox', { name: 'Page address' })).toHaveValue(
			`${origin.replace('http://', '')}/admin`,
		);
		await expect(inspector.getByText('Open a page')).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});

test('a picked element starts its own thread, pinned where you asked, that opens as its own tab and leaves the main chat alone', async () => {
	test.setTimeout(180_000);
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end(
			'<!doctype html><title>Pricing</title><main style="padding:80px"><h1>Pricing</h1><p>Plans for every team.</p></main>',
		);
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const web = webPage(electronApp, origin);
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-thread-ws',
			'Browser thread',
		);
		await openWorkstream(page, seeded.workstreamId);
		await showInspector(page);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });
		await sendPrompt(page, 'Hello main chat');
		await expectAssistantReply(page);
		const chatTabs = page.getByTestId('chat-agent-tab');
		await expect(chatTabs).toHaveCount(1);

		await openTab(page, origin, '/pricing');
		await expect(inspector.getByRole('tab', { name: 'Pricing', selected: true })).toBeVisible();
		await askAboutElement(page, web, 'h1', 'Make the title bigger');
		await expect(page.getByRole('button', { name: 'Pick an element' })).toHaveAttribute(
			'aria-pressed',
			'false',
		);
		await expect(chatTabs).toHaveCount(1);
		await expect(page.getByText('Make the title bigger')).toHaveCount(0);

		await web.clickAt(`${PINS}.querySelector('button.pin')`);
		await expect
			.poll(() => web.inPage(`${PINS}.querySelector('[role="dialog"]').hidden`))
			.toBe(false);
		await web.clickAt(
			`Array.from(${PINS}.querySelectorAll('button')).find((button) => button.textContent === 'Open chat')`,
		);
		await expect(chatTabs).toHaveCount(2);
		await expect(page.getByText('Make the title bigger').first()).toBeVisible({ timeout: 20_000 });
		await captureFlow(app, 'browser-thread-opened');

		await page.locator('[data-testid="chat-agent-tab"][aria-selected="false"]').click();
		await expect(page.getByText('Hello main chat').first()).toBeVisible();
		await expect(page.getByText('Make the title bigger')).toHaveCount(0);
		await expect(chatTabs).toHaveCount(1);
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});

test('a thread pin stays on its element when a Vite dev server hot-updates the page, changes its classes, or reloads it', async () => {
	test.setTimeout(180_000);
	const site = realpathSync(temporaryRoot('malini-hmr-site-'));
	const writeIndex = (title: string): void =>
		writeFileSync(
			join(site, 'index.html'),
			`<!doctype html><title>${title}</title><style>main { padding: 80px; } h1 { display: inline-block; margin: 0; font: 700 36px system-ui; } h1.text-6xl { font-size: 60px; }</style><main><div id="app"></div></main><script type="module" src="/main.js"></script>`,
		);
	const writeApp = (size: string, line: string): void =>
		writeFileSync(
			join(site, 'main.js'),
			`document.querySelector('#app').innerHTML = '<h1 class="${size} font-bold">Pricing</h1><p>${line}</p>';\nimport.meta.hot?.accept();\n`,
		);
	writeIndex('Pricing');
	writeApp('text-4xl', 'Plans for every team.');
	const vite = await createViteServer({
		configFile: false,
		root: site,
		logLevel: 'error',
		server: { host: 'localhost', port: 0 },
	});
	await vite.listen();
	const origin = (vite.resolvedUrls?.local[0] ?? '').replace(/\/$/u, '');
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const web = webPage(electronApp, origin);
		const pinOnHeading = () =>
			web.inPage(`(() => {
				const pin = ${PINS}?.querySelector('button.pin');
				const heading = document.querySelector('h1')?.getClientRects()[0];
				if (!pin || pin.hidden || !heading) return false;
				const box = pin.getBoundingClientRect();
				return Math.abs(box.left + box.width / 2 - heading.right) <= box.width
					&& Math.abs(box.top + box.height / 2 - heading.top) <= box.height;
			})()`);
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-hmr-ws',
			'Browser hot reload',
		);
		await openWorkstream(page, seeded.workstreamId);
		await showInspector(page);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });
		await openTab(page, origin, '/');
		await expect(inspector.getByRole('tab', { name: 'Pricing', selected: true })).toBeVisible();
		await askAboutElement(page, web, 'h1', 'Make the title bigger');
		await expect.poll(pinOnHeading).toBe(true);
		await web.inPage('window.stillThisDocument = true');

		writeApp('text-4xl', 'Plans for every team, billed yearly.');
		await expect
			.poll(() => web.inPage(`document.querySelector('p')?.textContent`))
			.toBe('Plans for every team, billed yearly.');
		expect(await web.inPage('window.stillThisDocument')).toBe(true);
		await expect.poll(pinOnHeading).toBe(true);

		writeApp('text-6xl', 'Plans for every team, billed yearly.');
		await expect
			.poll(() => web.inPage(`document.querySelector('h1')?.className`))
			.toBe('text-6xl font-bold');
		expect(await web.inPage('window.stillThisDocument')).toBe(true);
		await expect.poll(pinOnHeading).toBe(true);

		writeIndex('Pricing plans');
		await expect(
			inspector.getByRole('tab', { name: 'Pricing plans', selected: true }),
		).toBeVisible();
		expect(await web.inPage('window.stillThisDocument')).toBeUndefined();
		await expect.poll(pinOnHeading).toBe(true);
		await captureFlow(app, 'browser-thread-pin-after-reload');
		expectCleanConsole(app);
	} finally {
		await app.close();
		await vite.close();
		rmSync(site, { recursive: true, force: true });
	}
});

test('picking an element on a page that is still loading waits for the page instead of failing', async () => {
	test.setTimeout(120_000);
	let respond = (): void => undefined;
	const responding = new Promise<void>((resolve) => {
		respond = resolve;
	});
	const server = createServer(async (_request, response) => {
		await responding;
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end('<!doctype html><title>Late page</title><h1>Late page</h1>');
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const pickerShown = () =>
			electronApp.evaluate(
				({ webContents }, origin) =>
					webContents
						.getAllWebContents()
						.find((contents) => contents.getURL().startsWith(origin))
						?.executeJavaScript(`Boolean(document.querySelector('malini-picker'))`) ?? false,
				origin,
			);
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-late-pick-ws',
			'Browser late pick',
		);
		await openWorkstream(page, seeded.workstreamId);
		await showInspector(page);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });

		await openTab(page, origin, '/late');
		const pick = page.getByRole('button', { name: 'Pick an element' });
		await expect(pick).toBeEnabled();
		await pick.click();
		await expect(pick).toHaveAttribute('aria-pressed', 'true');
		respond();

		await expect(inspector.getByRole('tab', { name: 'Late page', selected: true })).toBeVisible();
		await expect.poll(pickerShown).toBe(true);
		await expect(pick).toHaveAttribute('aria-pressed', 'true');
		await pick.click();
		await expect(pick).toHaveAttribute('aria-pressed', 'false');
		await expect.poll(pickerShown).toBe(false);
		expectCleanConsole(app);
	} finally {
		respond();
		await app.close();
		server.close();
	}
});

async function closedInspector(page: Page): Promise<void> {
	const gutter = page.getByTestId('extension-inspector-gutter');
	await expect(gutter.getByRole('button', { name: /^Changes/u })).toBeEnabled({ timeout: 20_000 });
	await expect(gutter.getByRole('button', { name: 'Show inspector' })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Inspector' }).getByRole('tab')).toHaveCount(0);
}

function lobbyServer(): Promise<{ origin: string; close: () => void }> {
	const server = createServer((request, response) => {
		const title = request.url === '/lobby' ? 'Lobby music' : 'Release notes';
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end(`<!doctype html><title>${title}</title><h1>${title}</h1>`);
	});
	return new Promise((resolve) =>
		server.listen(0, 'localhost', () =>
			resolve({
				origin: `http://localhost:${(server.address() as AddressInfo).port}`,
				close: () => server.close(),
			}),
		),
	);
}

test('a page the agent opens shows up as its own tab, named by its title, without taking the cursor, and holds a closed inspector open only until the agent closes it', async () => {
	test.setTimeout(120_000);
	const server = await lobbyServer();
	const app = await launchMalini();
	try {
		const { page } = app;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-agent-ws',
			'Browser agent',
		);
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await closedInspector(page);

		await sendPrompt(page, `Open the lobby BROWSER_OPEN:${server.origin}/lobby`);
		await expectAssistantReply(page);

		await expect(inspector.getByRole('tab', { name: 'Lobby music', selected: true })).toBeVisible({
			timeout: 20_000,
		});
		await expect(inspector.getByRole('tab', { name: 'Files', selected: false })).toBeVisible();
		await expect(inspector.getByRole('tab')).toHaveCount(2);
		await expect(page.getByTestId('extension-inspector-gutter')).toHaveCount(0);
		await expect(page.getByRole('textbox', { name: 'Page address' })).not.toBeFocused();
		await captureFlow(app, 'browser-tab-agent-opened');

		await sendPrompt(page, 'Done with the lobby BROWSER_CLOSE');
		await expect(page.getByText('Closed your browser tab and its page.')).toBeVisible({
			timeout: 20_000,
		});
		await closedInspector(page);
		await expect(page.getByRole('button', { name: 'Hide inspector' })).toHaveCount(0);

		await openWorkstream(page, seeded.workstreamId);
		await closedInspector(page);
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});

test('an inspector the agent opened stays open after the agent closes its page once you click its tab', async () => {
	test.setTimeout(120_000);
	const server = await lobbyServer();
	const app = await launchMalini();
	try {
		const { page } = app;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-agent-kept-ws',
			'Browser agent kept',
		);
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await closedInspector(page);

		await sendPrompt(page, `Open the lobby BROWSER_OPEN:${server.origin}/lobby`);
		await expectAssistantReply(page);
		const lobby = inspector.getByRole('tab', { name: 'Lobby music', selected: true });
		await expect(lobby).toBeVisible({ timeout: 20_000 });
		await lobby.click();

		await sendPrompt(page, 'Done with the lobby BROWSER_CLOSE');
		await expect(page.getByText('Closed your browser tab and its page.')).toBeVisible({
			timeout: 20_000,
		});
		await expect(inspector.getByRole('tab', { name: 'Lobby music' })).toHaveCount(0);
		await expect(inspector.getByRole('tab', { name: 'Files', selected: true })).toBeVisible();
		await expect(page.getByTestId('extension-inspector-gutter')).toHaveCount(0);

		await openWorkstream(page, seeded.workstreamId);
		await expect(inspector.getByRole('tab', { name: 'Files', selected: true })).toBeVisible({
			timeout: 20_000,
		});
		await expect(page.getByRole('button', { name: 'Hide inspector' })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});

test('Browser in the closed inspector opens a new tab with the address ready to type', async () => {
	test.setTimeout(120_000);
	const server = await lobbyServer();
	const app = await launchMalini();
	try {
		const { page } = app;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-gutter-ws',
			'Browser gutter',
		);
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await closedInspector(page);

		await page
			.getByTestId('extension-inspector-gutter')
			.getByRole('button', { name: 'Browser', exact: true })
			.click();
		const address = page.getByRole('textbox', { name: 'Page address' });
		await expect(address).toBeFocused();
		await address.fill(`${server.origin}/lobby`);
		await address.press('Enter');
		await expect(inspector.getByRole('tab', { name: 'Lobby music', selected: true })).toBeVisible();
		await captureFlow(app, 'browser-tab-from-gutter');
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});

test('the agent resizes the browser tab you see by moving the divider, stops where the chat or the inspector keeps its width, and sizes a tab you do not see without moving it', async () => {
	test.setTimeout(120_000);
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end(
			'<!doctype html><title>Width</title><script>const name = () => (document.title = `Width ${innerWidth}`); addEventListener("resize", name); name();</script>',
		);
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		await electronApp.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0]?.setContentSize(1_600, 800),
		);
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-resize-ws',
			'Browser resize',
		);
		await openWorkstream(page, seeded.workstreamId);
		await showInspector(page);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });
		await sendPrompt(page, `Open the ruler BROWSER_OPEN:${origin}/ruler`);
		await expectAssistantReply(page);
		await expect(inspector.getByRole('tab', { name: /^Width \d+$/u, selected: true })).toBeVisible({
			timeout: 20_000,
		});
		const split = page.getByRole('separator', { name: 'Resize workstream-transcript' });

		await sendPrompt(page, 'As narrow as it gets BROWSER_RESIZE:200');
		await expect(page.getByText(/the narrowest the inspector gets/u)).toBeVisible({
			timeout: 20_000,
		});
		await captureFlow(app, 'browser-resize-before');

		await sendPrompt(page, 'As wide as it gets BROWSER_RESIZE:5000');
		await expect(page.getByText(/allows while the chat keeps its minimum width/u)).toBeVisible({
			timeout: 20_000,
		});
		await expect(split).toHaveAttribute('aria-valuenow', '400');
		await captureFlow(app, 'browser-resize-after');

		await sendPrompt(page, 'Make it 700 wide BROWSER_RESIZE:700');
		await expect(page.getByText('The page is now 700px wide.')).toBeVisible({ timeout: 20_000 });
		await expect(inspector.getByRole('tab', { name: 'Width 700', selected: true })).toBeVisible();
		const resized = await split.getAttribute('aria-valuenow');

		await inspector.getByRole('tab', { name: 'Files' }).click();
		await agentBrowser(
			page,
			{ action: 'resize', width: 390, height: 844 },
			'The page is now 390px wide and 844px tall.',
		);
		await expect(inspector.getByRole('tab', { name: 'Width 390', selected: false })).toBeVisible();
		await expect(split).toHaveAttribute('aria-valuenow', resized ?? '');
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});

test('the agent reads, clicks, types, hovers, presses, waits, scrolls, runs JavaScript, reads the console and captures a page you do not see, and your tab stays put', async () => {
	test.setTimeout(180_000);
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end(`<!doctype html><title>Sign-up</title>
<style>body{margin:0;font:16px sans-serif}#tip{visibility:hidden}#hint:hover~#tip{visibility:visible}#rest{height:3000px}</style>
<h1>Join the list</h1>
<label>Email <input id="email"></label>
<button id="join">Join</button>
<p id="result"></p>
<p><span id="hint">Why join</span> <span id="tip">Monthly notes</span></p>
<p id="pressed"></p>
<div id="rest"></div>
<script>
console.log('form ready');
document.getElementById('join').addEventListener('click', () => setTimeout(() => {
	document.getElementById('result').textContent = 'Joined as ' + document.getElementById('email').value;
}, 300));
addEventListener('keydown', (event) => { document.getElementById('pressed').textContent = 'Pressed ' + event.key; });
</script>`);
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-tools-ws',
			'Browser tools',
		);
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await sendPrompt(page, `Open the form BROWSER_OPEN:${origin}/form`);
		await expectAssistantReply(page);
		await expect(inspector.getByRole('tab', { name: 'Sign-up', selected: true })).toBeVisible({
			timeout: 20_000,
		});
		const files = inspector.getByRole('tab', { name: 'Files' });
		await files.click();

		await agentBrowser(page, { action: 'snapshot' }, 'textbox "Email" @e2');
		await agentBrowser(
			page,
			{ action: 'type', selector: '@e2', text: 'ada@example.com', submit: false },
			'Typed into `@e2`',
		);
		await agentBrowser(page, { action: 'click', selector: '@e3' }, 'Clicked `@e3`');
		await agentBrowser(
			page,
			{ action: 'wait', seconds: 5, gone: false, text: 'Joined as ada@example.com' },
			'"Joined as ada@example.com" shows.',
		);
		await agentBrowser(page, { action: 'hover', selector: '#hint' }, 'The mouse is over `#hint`');
		await agentBrowser(
			page,
			{ action: 'evaluate', script: `getComputedStyle(document.getElementById('tip')).visibility` },
			/^\s*visible\s*$/u,
		);
		await agentBrowser(page, { action: 'press', key: 'Shift+K' }, 'Pressed Shift+K.');
		await agentBrowser(
			page,
			{ action: 'evaluate', script: `document.getElementById('pressed').textContent` },
			/^\s*Pressed K\s*$/u,
		);
		await agentBrowser(
			page,
			{ action: 'scroll', x: 0, y: 5_000 },
			/The page is scrolled to x 0, y [1-9]\d* of \d+px\./u,
		);
		await agentBrowser(page, { action: 'console' }, '[info] form ready');
		await agentBrowser(
			page,
			{ action: 'screenshot', fullPage: true },
			new RegExp(`^Screenshot of ${origin}/form saved to `, 'u'),
		);
		await agentBrowser(
			page,
			{ action: 'resize', width: 390, height: 844 },
			'The page is now 390px wide and 844px tall.',
		);
		await agentBrowser(page, { action: 'screenshot', fullPage: false }, /saved to /u);
		const saved = /saved to (\S+\.png)\./u.exec(
			(await page
				.getByText(/saved to /u)
				.last()
				.textContent()) ?? '',
		)?.[1];
		const png = readFileSync(join(seeded.worktree, saved ?? 'missing.png'));
		const scale = await electronApp.evaluate(
			({ screen }) => screen.getPrimaryDisplay().scaleFactor,
		);
		expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([390 * scale, 844 * scale]);
		await expect(files).toHaveAttribute('aria-selected', 'true');
		await expect(inspector.getByRole('tab', { name: 'Sign-up', selected: false })).toBeVisible();
		await captureFlow(app, 'browser-tools-hidden-tab');
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});

test('the agent answers alerts and confirms, picks files for a file field and for a button, and leaves a page that asks to stay', async () => {
	test.setTimeout(180_000);
	const server = createServer((request, response) => {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end(
			request.url === '/done'
				? '<!doctype html><title>Done</title>'
				: `<!doctype html><title>Plan</title>
<button id="delete">Delete plan</button>
<button id="hello">Say hello</button>
<p id="status"></p>
<label>Avatar <input id="avatar" type="file"></label>
<input id="docs" type="file" multiple hidden>
<button id="attach">Attach files</button>
<p id="files"></p>
<script>
const status = document.getElementById('status');
const files = document.getElementById('files');
document.getElementById('delete').onclick = () => { status.textContent = confirm('Delete the plan?') ? 'Deleted' : 'Kept'; };
document.getElementById('hello').onclick = () => { alert('Hello'); status.textContent = 'Greeted'; };
for (const input of document.querySelectorAll('input[type=file]')) {
	input.addEventListener('change', () => {
		files.textContent = input.id + ': ' + [...input.files].map((file) => file.name + ' ' + file.size).join(', ');
	});
}
document.getElementById('attach').onclick = () => document.getElementById('docs').click();
addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = ''; });
</script>`,
		);
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	const app = await launchMalini();
	try {
		const { page } = app;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-dialogs-ws',
			'Browser dialogs',
		);
		mkdirSync(join(seeded.worktree, '.context'), { recursive: true });
		writeFileSync(join(seeded.worktree, '.context/avatar.png'), 'png');
		writeFileSync(join(seeded.worktree, '.context/a.txt'), 'a');
		writeFileSync(join(seeded.worktree, '.context/b.txt'), 'bb');
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await sendPrompt(page, `Open the plan BROWSER_OPEN:${origin}/plan`);
		await expectAssistantReply(page);
		await expect(inspector.getByRole('tab', { name: 'Plan', selected: true })).toBeVisible({
			timeout: 20_000,
		});
		const files = inspector.getByRole('tab', { name: 'Files' });
		await files.click();
		const status = { action: 'evaluate', script: `document.getElementById('status').textContent` };
		const picked = { action: 'evaluate', script: `document.getElementById('files').textContent` };

		const deleting =
			'The page shows a confirm dialog and waits for an answer: "Delete the plan?". Call browser_dialog';
		await agentBrowser(page, { action: 'click', selector: '#delete' }, deleting);
		await agentBrowser(page, { action: 'snapshot' }, deleting);
		await agentBrowser(
			page,
			{ action: 'dialog', accept: false },
			'Pressed Cancel on the confirm dialog. The page is now',
		);
		await agentBrowser(page, status, /^\s*Kept\s*$/u);
		await agentBrowser(page, { action: 'click', selector: '#delete' }, deleting);
		await agentBrowser(
			page,
			{ action: 'dialog', accept: true },
			'Pressed OK on the confirm dialog. The page is now',
		);
		await agentBrowser(page, status, /^\s*Deleted\s*$/u);
		await agentBrowser(
			page,
			{ action: 'click', selector: '#hello' },
			'The page shows an alert and waits for an answer: "Hello".',
		);
		await agentBrowser(page, { action: 'dialog', accept: false }, 'Closed the alert.');
		await agentBrowser(
			page,
			{ action: 'wait', seconds: 5, gone: false, text: 'Greeted' },
			'"Greeted" shows.',
		);
		await agentBrowser(page, { action: 'dialog', accept: true }, 'No dialog is open on the page.');

		await agentBrowser(
			page,
			{ action: 'upload', selector: '#avatar', paths: ['.context/avatar.png'] },
			'Picked one file for `#avatar`: .context/avatar.png.',
		);
		await agentBrowser(page, picked, /^\s*avatar: avatar\.png 3\s*$/u);
		await agentBrowser(
			page,
			{ action: 'upload', selector: '#avatar', paths: ['.context/a.txt', '.context/b.txt'] },
			'`#avatar` takes one file, and you passed 2. Pick one.',
		);
		await agentBrowser(
			page,
			{ action: 'upload', selector: '#attach', paths: ['.context/a.txt', '.context/b.txt'] },
			'Picked 2 files for `#attach`',
		);
		await agentBrowser(page, picked, /^\s*docs: a\.txt 1, b\.txt 2\s*$/u);
		await agentBrowser(
			page,
			{ action: 'click', selector: '#attach' },
			'`#attach` opened a file chooser, and Malini closed it.',
		);
		await agentBrowser(
			page,
			{ action: 'upload', selector: '#avatar', paths: ['/etc/hosts'] },
			'/etc/hosts is not a file in this worktree.',
		);

		await agentBrowser(page, { action: 'open', url: `${origin}/done` }, `Opened ${origin}/done`);
		await expect(files).toHaveAttribute('aria-selected', 'true');
		await expect(inspector.getByRole('tab', { name: 'Done', selected: false })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});

test('the agent reads, types into, clicks, waits on and captures controls in same-origin and cross-origin frames', async () => {
	test.setTimeout(180_000);
	const card = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end(`<!doctype html><title>Card</title>
<label>Card number <input id="number"></label>
<button id="pay">Pay</button>
<p id="paid"></p>
<script>
document.getElementById('pay').onclick = () => setTimeout(() => {
	document.getElementById('paid').textContent = 'Paid with ' + document.getElementById('number').value.slice(-4);
}, 200);
</script>`);
	});
	await new Promise<void>((resolve) => card.listen(0, '127.0.0.1', resolve));
	const cardOrigin = `http://127.0.0.1:${(card.address() as AddressInfo).port}`;
	const shop = createServer((request, response) => {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end(
			request.url === '/coupon'
				? `<!doctype html>
<label>Coupon <input id="coupon"></label>
<button id="apply">Apply</button>
<p id="applied"></p>
<script>
document.getElementById('apply').onclick = () => {
	document.getElementById('applied').textContent = 'Applied ' + document.getElementById('coupon').value;
};
</script>`
				: `<!doctype html><title>Checkout</title>
<style>body{margin:0;font:16px sans-serif}iframe{display:block;width:420px;height:180px;border:0}</style>
<h1>Checkout</h1>
<iframe title="Coupon" src="/coupon"></iframe>
<div style="height:1600px"></div>
<iframe title="Card" src="${cardOrigin}/card"></iframe>`,
		);
	});
	await new Promise<void>((resolve) => shop.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(shop.address() as AddressInfo).port}`;
	const app = await launchMalini();
	try {
		const { page } = app;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-frames-ws',
			'Browser frames',
		);
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await sendPrompt(page, `Open the checkout BROWSER_OPEN:${origin}/checkout`);
		await expectAssistantReply(page);
		await expect(inspector.getByRole('tab', { name: 'Checkout', selected: true })).toBeVisible({
			timeout: 20_000,
		});
		const files = inspector.getByRole('tab', { name: 'Files' });
		await files.click();

		await agentBrowser(page, { action: 'snapshot' }, /textbox "Card number" @f2e\d+/u);
		const snapshot =
			(await page
				.getByText(/textbox "Card number"/u)
				.last()
				.textContent()) ?? '';
		const ref = (control: string): string =>
			new RegExp(`${control} (@f\\de\\d+)`, 'u').exec(snapshot)?.[1] ?? `missing ${control}`;
		expect(snapshot).toContain('iframe "Coupon" -> /coupon:');
		expect(snapshot).toContain(`iframe "Card" -> ${cardOrigin}/card:`);

		await agentBrowser(
			page,
			{ action: 'type', selector: ref('textbox "Coupon"'), text: 'SAVE10', submit: false },
			`Typed into \`${ref('textbox "Coupon"')}\``,
		);
		await agentBrowser(
			page,
			{ action: 'click', selector: ref('button "Apply"') },
			`Clicked \`${ref('button "Apply"')}\``,
		);
		await agentBrowser(
			page,
			{ action: 'wait', seconds: 5, gone: false, text: 'Applied SAVE10' },
			'"Applied SAVE10" shows.',
		);
		await agentBrowser(
			page,
			{
				action: 'type',
				selector: ref('textbox "Card number"'),
				text: '4242 4242 4242 4242',
				submit: false,
			},
			`Typed into \`${ref('textbox "Card number"')}\``,
		);
		await agentBrowser(
			page,
			{ action: 'click', selector: ref('button "Pay"') },
			`Clicked \`${ref('button "Pay"')}\``,
		);
		await agentBrowser(
			page,
			{ action: 'wait', seconds: 5, gone: false, text: 'Paid with 4242' },
			'"Paid with 4242" shows.',
		);
		await agentBrowser(
			page,
			{ action: 'screenshot', fullPage: false, selector: ref('button "Pay"') },
			new RegExp(`^Screenshot of ${origin}/checkout saved to `, 'u'),
		);
		await expect(files).toHaveAttribute('aria-selected', 'true');
		expectCleanConsole(app);
	} finally {
		await app.close();
		shop.close();
		card.close();
	}
});

test('the agent closes the browser tab it opened and its page, leaves your tab and page alone, and its tab stays closed after a reload', async () => {
	test.setTimeout(120_000);
	const server = await lobbyServer();
	const { origin } = server;
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const webPages = () =>
			electronApp.evaluate(({ webContents }) =>
				webContents
					.getAllWebContents()
					.map((contents) => contents.getURL())
					.filter((url) => url.startsWith('http'))
					.sort(),
			);
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-close-ws',
			'Browser close',
		);
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await closedInspector(page);

		await sendPrompt(page, `Open the lobby BROWSER_OPEN:${origin}/lobby`);
		await expectAssistantReply(page);
		await expect(inspector.getByRole('tab', { name: 'Lobby music', selected: true })).toBeVisible({
			timeout: 20_000,
		});
		await openTab(page, origin, '/notes');
		await expect(
			inspector.getByRole('tab', { name: 'Release notes', selected: true }),
		).toBeVisible();
		await expect.poll(webPages).toEqual([`${origin}/lobby`, `${origin}/notes`]);

		await sendPrompt(page, 'Done with the lobby BROWSER_CLOSE');
		await expect(page.getByText('Closed your browser tab and its page.')).toBeVisible({
			timeout: 20_000,
		});
		await expect(inspector.getByRole('tab', { name: 'Lobby music' })).toHaveCount(0);
		await expect.poll(webPages).toEqual([`${origin}/notes`]);
		await expect(
			inspector.getByRole('tab', { name: 'Release notes', selected: true }),
		).toBeVisible();
		await expect(page.getByTestId('extension-inspector-gutter')).toHaveCount(0);
		await captureFlow(app, 'browser-tab-agent-closed');

		await openWorkstream(page, seeded.workstreamId);
		await expect(inspector.getByRole('tab', { name: 'Release notes' })).toBeVisible({
			timeout: 20_000,
		});
		await expect(inspector.getByRole('tab', { name: 'Lobby music' })).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});

test('a page that breaks off after it shows stays shown and pickable, and so does a blank page', async () => {
	test.setTimeout(120_000);
	const held: ServerResponse[] = [];
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html', 'content-length': '4096' });
		response.write('<!doctype html><title>Broken off</title><h1>Half a page</h1>');
		held.push(response);
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const pageShown = () =>
			electronApp.evaluate(({ BrowserWindow }) =>
				(BrowserWindow.getAllWindows()[0]?.contentView.children ?? []).some((view) =>
					view.getVisible(),
				),
			);
		const stillLoading = (prefix: string) =>
			electronApp.evaluate(
				({ webContents }, prefix) =>
					webContents
						.getAllWebContents()
						.find((contents) => contents.getURL().startsWith(prefix))
						?.isLoading() ?? true,
				prefix,
			);
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-broken-off-ws',
			'Browser broken off',
		);
		await openWorkstream(page, seeded.workstreamId);
		await showInspector(page);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });

		await openTab(page, origin, '/partial');
		await expect(inspector.getByRole('tab', { name: 'Broken off', selected: true })).toBeVisible();
		for (const response of held) response.destroy();
		await expect.poll(() => stillLoading(origin)).toBe(false);
		await untilBrowserEventsArrive(page, seeded.workstreamId);
		const pick = page.getByRole('button', { name: 'Pick an element' });
		await expect(pick).toBeEnabled();
		await expect(inspector.getByRole('status')).toHaveCount(0);
		await expect.poll(pageShown).toBe(true);

		const address = page.getByRole('textbox', { name: 'Page address' });
		await address.fill('about:blank');
		await address.press('Enter');
		await expect(address).toHaveValue('about:blank');
		await expect.poll(() => stillLoading('about:blank')).toBe(false);
		await untilBrowserEventsArrive(page, seeded.workstreamId);
		const blank = webPage(electronApp, 'about:blank');
		await pick.click();
		await expect
			.poll(() => blank.inPage(`Boolean(document.querySelector('malini-picker'))`))
			.toBe(true);
		await expect(pick).toHaveAttribute('aria-pressed', 'true');
		await pick.click();
		await expect(pick).toHaveAttribute('aria-pressed', 'false');
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});

test('a tab going back shows the address it goes back to while that page loads', async () => {
	test.setTimeout(120_000);
	let hold = false;
	const held: ServerResponse[] = [];
	const server = createServer((request, response) => {
		if (hold && request.url === '/first') {
			held.push(response);
			return;
		}
		const title = request.url === '/first' ? 'First page' : 'Second page';
		response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
		response.end(`<!doctype html><title>${title}</title><h1>${title}</h1>`);
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	const host = new URL(origin).host;
	const app = await launchMalini();
	try {
		const { page } = app;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-back-ws',
			'Browser back',
		);
		await openWorkstream(page, seeded.workstreamId);
		await showInspector(page);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });

		await openTab(page, origin, '/first');
		await expect(inspector.getByRole('tab', { name: 'First page', selected: true })).toBeVisible();
		const address = page.getByRole('textbox', { name: 'Page address' });
		await address.fill(`${origin}/second`);
		await address.press('Enter');
		await expect(inspector.getByRole('tab', { name: 'Second page', selected: true })).toBeVisible();

		hold = true;
		await page.getByRole('button', { name: 'Back', exact: true }).click();
		await expect.poll(() => held.length).toBe(1);
		await expect(address).toHaveValue(`${host}/first`);
		expectCleanConsole(app);
	} finally {
		for (const response of held) response.destroy();
		await app.close();
		server.close();
	}
});

test('a restored tab shows its address while its page loads', async () => {
	test.setTimeout(180_000);
	let hold = false;
	const held: ServerResponse[] = [];
	const server = createServer((request, response) => {
		if (hold && request.url === '/slow') {
			held.push(response);
			return;
		}
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end('<!doctype html><title>Slow page</title><h1>Slow page</h1>');
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
	const host = new URL(origin).host;
	const first = await launchMalini();
	let workstreamId = '';
	try {
		const { page } = first;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(first.root),
			'e2e-browser-restore-ws',
			'Browser restore',
		);
		workstreamId = seeded.workstreamId;
		await openWorkstream(page, workstreamId);
		await showInspector(page);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });
		await openTab(page, origin, '/slow');
		await expect(inspector.getByRole('tab', { name: 'Slow page', selected: true })).toBeVisible();
		await inspector.getByRole('tab', { name: 'Files' }).click();
		await expect(inspector.getByRole('tab', { name: 'Files', selected: true })).toBeVisible();
		expectCleanConsole(first);
		await first.quit();
	} catch (error) {
		await first.close();
		server.close();
		throw error;
	}

	hold = true;
	const app = await launchMalini({ profile: first.root });
	try {
		const { page } = app;
		await openWorkstream(page, workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		const slowTab = inspector.getByRole('tab', { name: `${host}/slow` });
		await expect(slowTab).toBeVisible({ timeout: 20_000 });
		await slowTab.click();

		await expect.poll(() => held.length).toBe(1);
		await untilBrowserEventsArrive(page, workstreamId);
		await expect(
			inspector.getByRole('tab', { name: `${host}/slow`, selected: true }),
		).toBeVisible();
		await expect(page.getByRole('textbox', { name: 'Page address' })).toHaveValue(`${host}/slow`);
		await expect(inspector.getByText('Open a page')).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		for (const response of held) response.destroy();
		await app.close();
		server.close();
	}
});
