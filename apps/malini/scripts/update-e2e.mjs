import { execFileSync, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';

const NAME = 'MaliniUpdateTest';
const OLD_NAME = NAME.toLowerCase();
const ID = 'app.malini.updatetest';
const PORT = 8765;
const BACKGROUND = { MALINI_BACKGROUND_WINDOW: '1', MALINI_USAGE_DATA: 'off' };
const THEME = process.env['MALINI_THEME'];
const LAUNCH = {
	args: [],
	env: { ...process.env, ...BACKGROUND },
	colorScheme: THEME === 'light' || THEME === 'dark' ? THEME : null,
};
const appRoot = resolve(import.meta.dirname, '..');
const dir = join(tmpdir(), 'malini-update-e2e');
const applications = join(dir, 'Applications');
const bundle = join(applications, `${OLD_NAME}.app`);
const executables = join(bundle, 'Contents/MacOS');
const userData = join(homedir(), 'Library/Application Support', OLD_NAME);

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {string}
 */
const sh = (command, args) =>
	execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const running = () => spawnSync('pgrep', ['-f', executables]).status === 0;
/** @param {string} key */
const installed = (key) => sh('defaults', ['read', join(bundle, 'Contents/Info.plist'), key]);
const installedVersion = () => installed('CFBundleShortVersionString');
const windowLayers = () =>
	/** @type {number[]} */ (
		JSON.parse(
			sh('osascript', [
				'-l',
				'JavaScript',
				'-e',
				`ObjC.import('CoreGraphics'); JSON.stringify(ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, $.kCGNullWindowID))).filter((w) => w.kCGWindowOwnerName?.toLowerCase() === '${OLD_NAME}' && w.kCGWindowBounds.Width > 1).map((w) => w.kCGWindowLayer))`,
			]),
		)
	);
/** @param {number} ms */
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * @param {string} what
 * @param {() => boolean | Promise<boolean>} test
 * @param {number} [ms]
 */
async function until(what, test, ms = 180_000) {
	for (const end = Date.now() + ms; Date.now() < end; await sleep(1000)) {
		try {
			if (await test()) return;
		} catch {
			continue;
		}
	}
	throw new Error(`timed out waiting for ${what}`);
}

/**
 * @param {string} version
 * @param {string} productName
 */
function build(version, productName) {
	const config = join(dir, `${version}.json`);
	writeFileSync(
		config,
		JSON.stringify({
			extends: join(appRoot, 'electron-builder.yml'),
			appId: ID,
			productName,
			extraMetadata: { name: OLD_NAME, productName, version },
			directories: { output: join(dir, version) },
			mac: {
				notarize: false,
				extendInfo: { LSEnvironment: BACKGROUND },
			},
			publish: [{ provider: 'generic', url: `http://127.0.0.1:${PORT}` }],
		}),
	);
	execFileSync(
		'pnpm',
		['exec', 'electron-builder', '--mac', 'zip', '--arm64', '--publish', 'never', '-c', config],
		{
			cwd: appRoot,
			stdio: 'inherit',
		},
	);
}

async function cleanup() {
	spawnSync('pkill', ['-TERM', '-f', executables]);
	await until('the app to quit', () => !running(), 15_000).catch(() =>
		spawnSync('pkill', ['-KILL', '-f', executables]),
	);
	for (const path of [
		`Library/Logs/${NAME}`,
		`Library/Logs/${OLD_NAME}`,
		`Library/Caches/${ID}.ShipIt`,
		`Library/Caches/${ID}`,
		`Library/Caches/${OLD_NAME}-updater`,
	]) {
		rmSync(join(homedir(), path), { recursive: true, force: true, maxRetries: 10 });
	}
	rmSync(userData, { recursive: true, force: true });
	spawnSync('security', ['delete-generic-password', '-s', `${OLD_NAME} Safe Storage`]);
	if (existsSync(bundle)) {
		spawnSync(
			'/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
			['-u', bundle],
		);
	}
	rmSync(applications, { recursive: true, force: true });
}

/** @param {import('@playwright/test').ElectronApplication} app */
const updateStatus = async (app) =>
	(await app.firstWindow()).evaluate(() =>
		globalThis.malini.invoke('app.update-status', undefined),
	);

/** @param {import('@playwright/test').ElectronApplication} app */
const appMenu = (app) =>
	app.evaluate(
		({ Menu }) =>
			Menu.getApplicationMenu()
				?.items[0]?.submenu?.items.map((item) => item.label)
				.filter(Boolean) ?? [],
	);

/** @param {import('@playwright/test').ElectronApplication} app */
const checkForUpdates = (app) =>
	app.evaluate(({ Menu }) => {
		const item = Menu.getApplicationMenu()?.items[0]?.submenu?.items.find(
			({ label }) => label === 'Check for Updates…',
		);
		if (!item) throw new Error('the app menu has no Check for Updates…');
		item.click();
	});

async function launchStagedUpdate() {
	await cleanup();
	published = '0.0.2';
	mkdirSync(userData, { recursive: true });
	writeFileSync(join(userData, '.update-e2e'), '');
	sh('ditto', ['-x', '-k', join(dir, '0.0.1', 'malini-0.0.1-arm64-mac.zip'), applications]);
	const app = await electron.launch({ ...LAUNCH, executablePath: join(executables, OLD_NAME) });
	await until(
		'0.0.2 to be ready to install',
		async () => (await updateStatus(app)).state === 'ready',
	);
	const menu = await appMenu(app);
	if (!menu.includes('Check for Updates…') || menu.includes('Restart to Update')) {
		throw new Error(`the app menu shows update status: ${menu.join(', ')}`);
	}
	console.log(`menu: ${menu.join(', ')}`);
	return app;
}

/** @param {import('@playwright/test').ElectronApplication} app */
async function openSidebar(app) {
	const page = await app.firstWindow();
	page.on('console', (message) => {
		if (message.type() === 'error') throw new Error(`console error: ${message.text()}`);
	});
	await page.evaluate(() =>
		globalThis.malini.invoke('app.set-setting', {
			key: 'onboarding.finished-at',
			value: new Date().toISOString(),
		}),
	);
	await page.reload();
	await page.getByTestId('sidebar-open-settings').waitFor();
	return page;
}

/**
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {string} name
 */
async function shot(app, name) {
	const windowId = await app.evaluate(({ BrowserWindow }) => {
		const [window] = BrowserWindow.getAllWindows();
		window?.webContents.invalidate();
		return window?.getMediaSourceId().split(':')[1];
	});
	await sleep(500);
	const path = join(appRoot, `../../.context/update-e2e-${name}.png`);
	mkdirSync(join(path, '..'), { recursive: true });
	if (windowId) sh('screencapture', ['-o', '-x', '-l', windowId, path]);
	console.log(`${name}: ${path}`);
}

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
build('0.0.1', OLD_NAME);
build('0.0.2', NAME);
build('0.0.3', NAME);

let published = '0.0.2';
let delay = 0;
let failing = false;
const feed = createServer((request, response) =>
	setTimeout(() => {
		if (failing) return void response.writeHead(500).end();
		const file = join(
			dir,
			published,
			decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname),
		);
		if (!existsSync(file)) return void response.writeHead(404).end();
		createReadStream(file).pipe(response);
	}, delay),
);
await new Promise((listening) => feed.listen(PORT, '127.0.0.1', () => listening(undefined)));

try {
	const quitting = await launchStagedUpdate();
	const sealed = await quitting.evaluate(({ safeStorage }) =>
		safeStorage.encryptString('sealed by 0.0.1').toString('base64'),
	);
	await quitting.evaluate(({ app }) => app.quit());
	await until('0.0.2 to be installed on quit', () => installedVersion() === '0.0.2');
	await sleep(5000);
	if (running()) throw new Error('a plain quit relaunched the app');
	if (installed('CFBundleName') !== NAME) throw new Error(`${bundle} does not hold ${NAME}`);
	console.log(`ok: quitting 0.0.1 installed 0.0.2, ${NAME}, into ${bundle}`);

	const renamed = await electron.launch({ ...LAUNCH, executablePath: join(executables, NAME) });
	const kept = await renamed.evaluate(
		({ app, safeStorage }, sealed) => ({
			name: app.getName(),
			userData: app.getPath('userData'),
			secret: safeStorage.decryptString(Buffer.from(sealed, 'base64')),
		}),
		sealed,
	);
	if (kept.name !== NAME || kept.userData !== userData || kept.secret !== 'sealed by 0.0.1') {
		throw new Error(`0.0.2 lost the data of 0.0.1: ${JSON.stringify(kept)}`);
	}
	console.log(`ok: ${NAME} 0.0.2 kept ${userData} and decrypted the secret 0.0.1 sealed`);

	const page = await openSidebar(renamed);
	const status = (/** @type {RegExp} */ text) => page.getByRole('status').filter({ hasText: text });
	delay = 2000;
	await checkForUpdates(renamed);
	await status(/Checking for updates…/u).waitFor();
	await shot(renamed, 'checking');
	await status(/Malini is up to date\s*0\.0\.2/u).waitFor();
	await shot(renamed, 'up-to-date');
	await status(/Malini is up to date/u).waitFor({ state: 'detached', timeout: 15_000 });
	failing = true;
	await checkForUpdates(renamed);
	const retry = page.getByRole('button', { name: 'Update failed, check again' });
	await retry.waitFor();
	await shot(renamed, 'failed');
	failing = false;
	await retry.click();
	await status(/Checking for updates…/u).waitFor();
	await status(/Malini is up to date/u).waitFor();
	published = '0.0.3';
	await checkForUpdates(renamed);
	await status(/Downloading update\s*0\.0\.3/u).waitFor();
	await shot(renamed, 'downloading');
	await page.getByRole('button', { name: 'Restart to update to malini 0.0.3' }).waitFor();
	delay = 0;
	console.log(
		'ok: Check for Updates… showed checking, up to date, a failed check with Retry, and the download of 0.0.3 in the sidebar',
	);
	await renamed.evaluate(({ app }) => app.quit());
	await until('0.0.3 to be installed on quit', () => installedVersion() === '0.0.3');
	await until('0.0.2 to quit', () => !running(), 15_000);

	const restarting = await launchStagedUpdate();
	const restartButton = (await openSidebar(restarting)).getByRole('button', {
		name: 'Restart to update to malini 0.0.2',
	});
	await restartButton.waitFor();
	await shot(restarting, 'staged-update');
	published = '0.0.3';
	await restartButton.click();
	await until('0.0.3 to be installed', () => installedVersion() === '0.0.3');
	await until('0.0.3 to relaunch', running);
	await until('the relaunched app to open its window', () => windowLayers().length > 0);
	if (windowLayers().includes(0))
		throw new Error('the relaunched app put a window in front of the user');
	console.log(
		`ok: the in-app Restart to update with 0.0.2 staged installed the newer 0.0.3 and relaunched it behind every window (layers ${windowLayers().join(', ')})`,
	);
} finally {
	feed.close();
	await cleanup();
}
