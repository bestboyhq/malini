import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

async function feedServer(): Promise<{ server: Server; origin: string }> {
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://localhost');
		if (url.pathname === '/login') {
			response.writeHead(302, {
				location: '/feed',
				'set-cookie': `user=${url.searchParams.get('as') ?? ''}; Path=/; Max-Age=3600`,
			});
			response.end();
			return;
		}
		const user = /(?:^|; )user=(\w+)/u.exec(request.headers.cookie ?? '')?.[1];
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end(
			`<!doctype html><title>${user ? `Feed of ${user}` : 'Signed out'}</title><h1>${user ?? 'Sign in'}</h1>`,
		);
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	return { server, origin: `http://localhost:${(server.address() as AddressInfo).port}` };
}

function originPattern(url: string): string {
	return new URL(url).origin.replaceAll('.', '\\.');
}

async function agentOpens(page: Page, url: string, profile?: string): Promise<void> {
	const request =
		profile === undefined ? { action: 'open', url } : { action: 'open', url, profile };
	const encoded = Buffer.from(JSON.stringify(request)).toString('base64url');
	const where = profile === undefined ? '' : ` in browser profile ${profile}`;
	const answers = page.getByText(
		new RegExp(
			`^Opened ${originPattern(url)}\\S* \\(".+"\\)${where}\\. Call browser_screenshot`,
			'u',
		),
	);
	const before = await answers.count();
	await sendPrompt(page, `Browser open BROWSER_REQUEST:${encoded}`);
	await expect(answers).toHaveCount(before + 1, { timeout: 20_000 });
}

test('the agent opens one site in several browser profiles, each signed in on its own, side by side in one Browsers tab you can add to, switch and close', async () => {
	test.setTimeout(180_000);
	const { server, origin } = await feedServer();
	const app = await launchMalini();
	try {
		const { page } = app;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-profiles-ws',
			'Browser profiles',
		);
		await openWorkstream(page, seeded.workstreamId);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		const column = (name: string) => inspector.getByRole('region', { name, exact: true });

		await agentOpens(page, `${origin}/login?as=cats`, 'reddit-cats');
		await expect(inspector.getByRole('tab', { name: 'Feed of cats', selected: true })).toBeVisible({
			timeout: 20_000,
		});
		await expect(inspector.getByRole('button', { name: 'Profile reddit-cats' })).toBeVisible();

		await agentOpens(page, `${origin}/login?as=dogs`, 'reddit-dogs');
		await agentOpens(page, `${origin}/feed`);
		await expect(inspector.getByRole('tab', { name: 'Browsers', selected: true })).toBeVisible({
			timeout: 20_000,
		});
		await expect(inspector.getByRole('tab', { name: /^Feed of|^Signed out/u })).toHaveCount(0);
		await expect(column('reddit-cats: Feed of cats')).toBeVisible({ timeout: 20_000 });
		await expect(column('reddit-dogs: Feed of dogs')).toBeAttached({ timeout: 20_000 });
		await expect(column('default: Signed out')).toBeAttached({ timeout: 20_000 });

		await agentOpens(page, `${origin}/feed`, 'reddit-cats');
		await expect(column('reddit-cats: Feed of cats')).toBeAttached({ timeout: 20_000 });
		await expect(inspector.getByRole('region', { name: /^reddit-cats:/u })).toHaveCount(1);

		const signedOut = column('default: Signed out');
		await signedOut.scrollIntoViewIfNeeded();
		await signedOut.getByRole('button', { name: 'Profile default' }).click();
		await expect(page.getByRole('menu', { name: 'Profile' }).getByRole('menuitemradio')).toHaveText(
			['default', 'reddit-cats', 'reddit-dogs'],
		);
		await page.getByRole('menuitemradio', { name: 'reddit-dogs' }).click();
		await expect(page.getByRole('menu')).toHaveCount(0);
		await expect(inspector.getByRole('region', { name: 'reddit-dogs: Feed of dogs' })).toHaveCount(
			2,
			{ timeout: 20_000 },
		);

		const add = inspector.getByRole('button', { name: 'Add column' });
		await add.scrollIntoViewIfNeeded();
		await add.click();
		await page.getByRole('menuitem', { name: 'New profile…' }).click();
		await page.getByRole('textbox', { name: 'New profile name' }).fill('Reddit Birds');
		await page.getByRole('textbox', { name: 'New profile name' }).press('Enter');
		const birds = column('reddit-birds: New tab');
		await expect(birds).toBeInViewport({ timeout: 20_000 });
		const address = birds.getByRole('textbox', { name: 'Page address' });
		await expect(address).toBeFocused();
		await address.fill(`${origin}/feed`);
		await address.press('Enter');
		await expect(column('reddit-birds: Signed out')).toBeVisible({ timeout: 20_000 });
		await captureFlow(app, 'browser-profiles-deck');

		await column('reddit-birds: Signed out')
			.getByRole('button', { name: 'Close Signed out' })
			.click();
		await expect(inspector.getByRole('region', { name: /^reddit-birds:/u })).toHaveCount(0);

		const sideBySide = column('reddit-cats: Feed of cats').getByRole('button', {
			name: 'Side by side',
		});
		await column('reddit-cats: Feed of cats').scrollIntoViewIfNeeded();
		await expect(sideBySide).toHaveAttribute('aria-pressed', 'true');
		await sideBySide.click();
		await expect(inspector.getByRole('tab', { name: 'Feed of cats', selected: true })).toBeVisible({
			timeout: 20_000,
		});
		await expect(inspector.getByRole('tab', { name: 'Feed of dogs' })).toHaveCount(2);
		await expect(inspector.getByRole('tab', { name: 'Browsers' })).toHaveCount(0);
		await expect(inspector.getByRole('button', { name: 'Profile reddit-cats' })).toBeVisible();

		await inspector.getByRole('button', { name: 'Side by side' }).click();
		await expect(inspector.getByRole('tab', { name: 'Browsers', selected: true })).toBeVisible({
			timeout: 20_000,
		});
		await expect(inspector.getByRole('region', { name: /^reddit-/u })).toHaveCount(3);
		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});
