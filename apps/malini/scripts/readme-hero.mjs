import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'vite';

const APP_ROOT = join(import.meta.dirname, '..');
const HERO = join(APP_ROOT, '../../.github/readme/hero.webp');
const HOST = join(APP_ROOT, 'tests/e2e/fixtures/demo-host.cjs');
const VIEW = { width: 1280, height: 800, deviceScaleFactor: 2 };
const WINDOW_RADIUS = 16;
const QUALITY = 0.82;
const RESTING_POINTER = { x: 150, y: 650 };
const SETTLE_MS = 2_500;
const STEP_TIMEOUT_MS = 60_000;

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ prompt: string; tonyId: string }} tour
 */
async function playScene(page, { prompt, tonyId }) {
	await page.getByTestId('sidebar-new-chat-row').click();
	await page.getByRole('listbox').getByRole('option').first().click();
	await page.getByTestId('chat-composer-input').click();
	await page.keyboard.insertText(prompt);
	await page.getByTestId('chat-composer-submit').click();
	const tony = page.locator(`[data-testid="sidebar-workstream"][data-workstream-id="${tonyId}"]`);
	await tony.waitFor();
	await page
		.locator('[data-testid="sidebar-workstream"]:not([data-workstream-state="completed"])')
		.first()
		.waitFor({ state: 'detached' });
	await tony.click();
	await page.locator('button[aria-label="Pick an element"]:not([disabled])').waitFor();
	await page.getByTestId('chat-activity-group-summary').click();
	await page.locator('[data-testid="chat-activity-group-summary"][aria-expanded="true"]').waitFor();
	await page.mouse.move(RESTING_POINTER.x, RESTING_POINTER.y);
	await page.waitForTimeout(SETTLE_MS);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {Buffer} png
 */
async function encodeWindow(page, png) {
	await page.goto('about:blank');
	const encoded = await page.evaluate(
		async ({ png, radius, quality }) => {
			const image = new Image();
			image.src = `data:image/png;base64,${png}`;
			await image.decode();
			const canvas = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
			const context = canvas.getContext('2d');
			if (!context) throw new Error('the encoder has no 2d canvas');
			context.beginPath();
			context.roundRect(0, 0, canvas.width, canvas.height, radius);
			context.clip();
			context.drawImage(image, 0, 0);
			const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
			const url = await new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(reader.result);
				reader.onerror = () => reject(reader.error);
				reader.readAsDataURL(blob);
			});
			return { type: blob.type, width: canvas.width, height: canvas.height, url: String(url) };
		},
		{
			png: png.toString('base64'),
			radius: WINDOW_RADIUS * VIEW.deviceScaleFactor,
			quality: QUALITY,
		},
	);
	const width = VIEW.width * VIEW.deviceScaleFactor;
	const height = VIEW.height * VIEW.deviceScaleFactor;
	if (encoded.type !== 'image/webp') throw new Error(`the encoder wrote ${encoded.type}`);
	if (encoded.width !== width || encoded.height !== height) {
		throw new Error(`the scene rendered at ${encoded.width}x${encoded.height}`);
	}
	return Buffer.from(encoded.url.slice(encoded.url.indexOf(',') + 1), 'base64');
}

const server = await createServer({
	configFile: join(APP_ROOT, 'vite.demo.config.ts'),
	logLevel: 'error',
	server: { host: '127.0.0.1', port: 0 },
});
try {
	await server.listen();
	const [origin] = server.resolvedUrls?.local ?? [];
	if (!origin) throw new Error('the demo server has no local url');
	const { TOUR_PROMPT, TOUR_TONY_ID } = await server.ssrLoadModule('/demo-tour-data.ts');
	const app = await electron.launch({
		args: [HOST, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
		env: { ...process.env, MALINI_BACKGROUND_WINDOW: '1' },
		colorScheme: 'dark',
	});
	try {
		await app.firstWindow();
		const opened = app.waitForEvent('window');
		await app.evaluate(({ BrowserWindow }, { width, height, deviceScaleFactor }) => {
			const retina = new BrowserWindow({
				width,
				height,
				show: false,
				useContentSize: true,
				webPreferences: { offscreen: { deviceScaleFactor }, backgroundThrottling: false },
			});
			void retina.loadURL('about:blank');
		}, VIEW);
		const page = await opened;
		page.setDefaultTimeout(STEP_TIMEOUT_MS);
		/** @type {string[]} */
		const errors = [];
		page.on('console', (message) => {
			if (message.type() === 'error') errors.push(message.text());
		});
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto(new URL('app.html', origin).href, { waitUntil: 'commit' });
		await playScene(page, { prompt: TOUR_PROMPT, tonyId: TOUR_TONY_ID });
		if (errors.length > 0) throw new Error(`console errors:\n${errors.join('\n')}`);
		writeFileSync(HERO, await encodeWindow(page, await page.screenshot()));
		console.log('Retook .github/readme/hero.webp');
	} finally {
		await app.close();
	}
} finally {
	await server.close();
}
