import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	DOCKER_CONTAINERS_FIXTURE,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

const ORDERS = 'e2e-running-orders-ws';
const QUIET = 'e2e-running-quiet-ws';

function composeContainer(
	service: string,
	startedAt: number,
	ports: readonly number[],
	dependsOn: readonly string[] = [],
): Record<string, unknown> {
	return {
		Id: `container-${service}`,
		Name: `/orders-api-${service}-1`,
		State: { Running: true, StartedAt: new Date(startedAt).toISOString() },
		Config: {
			Image: `orders/${service}`,
			Labels: {
				'app.malini.workstream': ORDERS,
				'com.docker.compose.project': 'orders-api',
				'com.docker.compose.service': service,
				'com.docker.compose.project.working_dir': '/srv/orders',
				'com.docker.compose.depends_on': dependsOn
					.map((dependency) => `${dependency}:service_started:false`)
					.join(','),
			},
		},
		NetworkSettings: {
			Ports: Object.fromEntries(ports.map((port) => [`${port}/tcp`, [{ HostPort: String(port) }]])),
		},
	};
}

function seedContainers(root: string, port: number): void {
	const folder = join(root, 'home', DOCKER_CONTAINERS_FIXTURE);
	mkdirSync(folder, { recursive: true });
	const now = Date.now();
	for (const container of [
		composeContainer('api', now - (3 * 60 + 2) * 60_000, [port], ['postgres', 'redis']),
		composeContainer('worker', now, []),
		composeContainer('postgres', now - 60_000, []),
		composeContainer('redis', now - 60_000, []),
	]) {
		writeFileSync(join(folder, String(container['Id'])), JSON.stringify(container));
	}
}

function sidebarRow(page: Page, workstreamId: string) {
	return page.locator(`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`);
}

test('a workstream names what keeps running under it, opens its ports and stops it', async () => {
	test.setTimeout(120_000);
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end('<!doctype html><title>Orders API</title><h1>Orders API</h1>');
	});
	await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
	const address = server.address();
	if (address === null || typeof address === 'string')
		throw new Error('the page server has no port');
	const { port } = address;
	const root = mkdtempSync(join(tmpdir(), 'malini-e2e-'));
	seedContainers(root, port);
	const app = await launchMalini({ profile: root });
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		await seedWorkstream(page, source, QUIET, 'Quiet');
		await seedWorkstream(page, source, ORDERS, 'Orders');
		await openWorkstream(page, ORDERS);

		await sendPrompt(page, 'BACKGROUND_COMMAND');

		const strip = page.getByRole('region', { name: '1 background command running' });
		await expect(strip).toContainText('Run the e2e suite', { timeout: 20_000 });
		const orders = sidebarRow(page, ORDERS);
		await expect(orders).toContainText('Running: malini, api, worker', { timeout: 20_000 });
		await expect(sidebarRow(page, QUIET)).not.toContainText('Running:');
		await captureFlow(app, 'workstream-running-line');

		await openWorkstream(page, QUIET);
		await orders.hover();
		const card = page.getByTestId('workstream-running-card');
		await expect(card).toBeVisible();
		await expect(card).toContainText('3 running');
		await expect(card.getByRole('list', { name: 'Started by the agent' })).toContainText('malini');
		const docker = card.getByRole('list', { name: 'Docker · orders-api' });
		await expect(docker.getByRole('listitem')).toHaveCount(2);
		await expect(card).toContainText('Behind them: postgres · redis');
		const elapsed = (name: string) =>
			card
				.getByRole('listitem')
				.filter({ has: page.getByRole('button', { name: `Stop ${name}` }) })
				.getByTestId('running-item-elapsed');
		await expect(elapsed('api')).toHaveText('3h 2m');
		const workerElapsed = await elapsed('worker').textContent();
		await expect.poll(() => elapsed('worker').textContent()).not.toBe(workerElapsed);
		await captureFlow(app, 'workstream-running-card');

		await page.keyboard.press('Escape');
		await expect(card).toBeHidden();

		await page.mouse.move(0, 0);
		await orders.hover();
		await card.getByRole('button', { name: `Open localhost:${port}` }).click();
		await expect.poll(() => page.evaluate(() => location.hash)).toContain(ORDERS);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Orders API' })).toBeVisible({
			timeout: 20_000,
		});
		await captureFlow(app, 'workstream-running-port');

		await orders.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Stop api' }).click();
		await expect(orders).toContainText('Running: malini, postgres, redis, worker', {
			timeout: 20_000,
		});

		await expect(page.getByRole('menu')).toHaveCount(0);
		await page.mouse.move(0, 0);
		await orders.hover();
		await card.getByRole('button', { name: 'Stop all' }).click();
		await expect(orders).not.toContainText('Running:', { timeout: 20_000 });
		await expect(strip).toHaveCount(0);
		await captureFlow(app, 'workstream-running-stopped');

		expectCleanConsole(app);
	} finally {
		await app.close();
		server.close();
	}
});
