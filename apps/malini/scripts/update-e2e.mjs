import { execFileSync, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';

const NAME = 'MaliniUpdateTest';
const ID = 'app.malini.updatetest';
const PORT = 8765;
const BACKGROUND = { MALINI_BACKGROUND_WINDOW: '1', MALINI_USAGE_DATA: 'off' };
const appRoot = resolve(import.meta.dirname, '..');
const dir = resolve(appRoot, '../../.context/update-e2e');
const applications = join(dir, 'Applications');
const bundle = join(applications, `${NAME}.app`);
const executable = join(bundle, 'Contents/MacOS', NAME);
const userData = join(homedir(), 'Library/Application Support', NAME);

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {string}
 */
const sh = (command, args) =>
	execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const running = () => spawnSync('pgrep', ['-f', executable]).status === 0;
const installedVersion = () =>
	sh('defaults', ['read', join(bundle, 'Contents/Info.plist'), 'CFBundleShortVersionString']);
const windowLayers = () =>
	/** @type {number[]} */ (
		JSON.parse(
			sh('osascript', [
				'-l',
				'JavaScript',
				'-e',
				`ObjC.import('CoreGraphics'); JSON.stringify(ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, $.kCGNullWindowID))).filter((w) => w.kCGWindowOwnerName === '${NAME}' && w.kCGWindowBounds.Width > 1).map((w) => w.kCGWindowLayer))`,
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

/** @param {string} version */
function build(version) {
	const config = join(dir, `${version}.json`);
	writeFileSync(
		config,
		JSON.stringify({
			extends: join(appRoot, 'electron-builder.yml'),
			appId: ID,
			productName: NAME,
			extraMetadata: { name: NAME.toLowerCase(), productName: NAME, version },
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
	spawnSync('pkill', ['-TERM', '-f', executable]);
	await until('the app to quit', () => !running(), 15_000).catch(() =>
		spawnSync('pkill', ['-KILL', '-f', executable]),
	);
	for (const path of [
		`Library/Logs/${NAME}`,
		`Library/Caches/${ID}.ShipIt`,
		`Library/Caches/${ID}`,
		`Library/Caches/${NAME.toLowerCase()}-updater`,
	]) {
		rmSync(join(homedir(), path), { recursive: true, force: true });
	}
	rmSync(userData, { recursive: true, force: true });
	spawnSync('security', ['delete-generic-password', '-s', `${NAME} Safe Storage`]);
	if (existsSync(bundle)) {
		spawnSync(
			'/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
			['-u', bundle],
		);
	}
	rmSync(applications, { recursive: true, force: true });
}

async function launchStagedUpdate() {
	await cleanup();
	mkdirSync(userData, { recursive: true });
	writeFileSync(join(userData, '.update-e2e'), '');
	sh('ditto', ['-x', '-k', join(dir, '0.0.1', `${NAME}-0.0.1-arm64-mac.zip`), applications]);
	const app = await electron.launch({
		executablePath: executable,
		args: [],
		env: { ...process.env, ...BACKGROUND },
	});
	const appMenu = () =>
		app.evaluate(
			({ Menu }) =>
				Menu.getApplicationMenu()
					?.items[0]?.submenu?.items.map((item) => item.label)
					.filter(Boolean) ?? [],
		);
	await until('Restart to Update in the app menu', async () =>
		(await appMenu()).includes('Restart to Update'),
	);
	console.log(`menu: ${(await appMenu()).join(', ')}`);
	return app;
}

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
build('0.0.1');
build('0.0.2');

const feed = createServer((request, response) => {
	const file = join(
		dir,
		'0.0.2',
		decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname),
	);
	if (!existsSync(file)) return void response.writeHead(404).end();
	createReadStream(file).pipe(response);
});
await new Promise((listening) => feed.listen(PORT, '127.0.0.1', () => listening(undefined)));

try {
	const quitting = await launchStagedUpdate();
	await quitting.evaluate(({ app }) => app.quit());
	await until('0.0.2 to be installed on quit', () => installedVersion() === '0.0.2');
	await sleep(5000);
	if (running()) throw new Error('a plain quit relaunched the app');
	console.log('ok: quitting 0.0.1 installed 0.0.2');

	const restarting = await launchStagedUpdate();
	await restarting.evaluate(({ Menu }) =>
		Menu.getApplicationMenu()
			?.items[0]?.submenu?.items.find((item) => item.label === 'Restart to Update')
			?.click(),
	);
	await until('0.0.2 to be installed', () => installedVersion() === '0.0.2');
	await until('0.0.2 to relaunch', running);
	await until('the relaunched app to open its window', () => windowLayers().length > 0);
	if (windowLayers().includes(0))
		throw new Error('the relaunched app put a window in front of the user');
	console.log(
		`ok: Restart to Update installed 0.0.2 and relaunched it behind every window (layers ${windowLayers().join(', ')})`,
	);
} finally {
	feed.close();
	await cleanup();
}
