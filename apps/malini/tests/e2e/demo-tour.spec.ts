import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { APP_ROOT, E2E_ROOT } from './harness';

const TOUR_BUDGET_MS = 150_000;

test.describe('the landing page demo', () => {
	let server: ViteDevServer | undefined;
	let url = '';

	test.beforeAll(async () => {
		server = await createServer({
			configFile: join(APP_ROOT, 'vite.demo.config.ts'),
			logLevel: 'error',
			server: { host: '127.0.0.1', port: 0 },
		});
		await server.listen();
		const [origin] = server.resolvedUrls?.local ?? [];
		if (!origin) throw new Error('the demo server has no local url');
		url = new URL('app.html?play=tour', origin).href;
	});

	test.afterAll(async () => {
		await server?.close();
	});

	test('plays its tour to the last step, so a renamed test id fails here', async () => {
		test.setTimeout(TOUR_BUDGET_MS + 30_000);
		const app = await electron.launch({
			args: [
				join(E2E_ROOT, 'fixtures/demo-host.cjs'),
				'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
			],
			env: { ...process.env, MALINI_BACKGROUND_WINDOW: '1' },
		});
		try {
			const page = await app.firstWindow();
			const errors: string[] = [];
			page.on('console', (message) => {
				if (message.type() === 'error') errors.push(message.text());
			});
			page.on('pageerror', (error) => errors.push(error.message));

			await page.goto(url, { waitUntil: 'commit' });

			await expect(
				page.locator('.demo-cursor[data-gone]'),
				'the tour in src/renderer/demo/demo-tour.ts never reached its last step: a selector it waits for matches nothing, or a command it sends is refused',
			).toBeAttached({ timeout: TOUR_BUDGET_MS });
			await expect(
				page.locator('[data-testid="chat-agent-tab"][data-session-id^="thread-"]'),
			).toBeVisible();
			expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
		} finally {
			await app.close();
		}
	});
});
