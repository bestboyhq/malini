import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	clickRevealedOnHover,
	createSourceRepo,
	currentSessionId,
	DOCKER_CONTAINERS_FIXTURE,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	type LaunchedApp,
} from './harness';

const ORDERS = 'e2e-ports-orders-ws';
const QUIET = 'e2e-ports-quiet-ws';

function listPorts(worktree: string): void {
	mkdirSync(join(worktree, '.malini'), { recursive: true });
	writeFileSync(
		join(worktree, '.malini', 'workspace.json'),
		JSON.stringify({ schemaVersion: 1, ports: ['web', 'api'] }),
	);
}

async function environmentOfTurn(
	app: LaunchedApp,
	prompt: string,
): Promise<Record<string, string>> {
	const { page } = app;
	await sendPrompt(page, prompt);
	await expectAssistantReply(page);
	const sessionId = currentSessionId(page);
	const recorded = join(app.home, 'malini-environments.jsonl');
	await expect.poll(() => existsSync(recorded)).toBe(true);
	const entries = readFileSync(recorded, 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as { sessionId: string; environment: Record<string, string> })
		.filter((entry) => entry.sessionId === sessionId);
	const latest = entries.at(-1);
	if (!latest) throw new Error(`no environment was recorded for ${sessionId}`);
	return latest.environment;
}

function servesOn(app: LaunchedApp, port: number): void {
	const folder = join(app.home, DOCKER_CONTAINERS_FIXTURE);
	mkdirSync(folder, { recursive: true });
	writeFileSync(
		join(folder, 'container-web'),
		JSON.stringify({
			Id: 'container-web',
			Name: '/orders-web-1',
			State: { Running: true, StartedAt: new Date().toISOString() },
			Config: {
				Image: 'orders/web',
				Labels: {
					'app.malini.workstream': ORDERS,
					'com.docker.compose.project': 'orders',
					'com.docker.compose.service': 'web',
				},
			},
			NetworkSettings: { Ports: { '5173/tcp': [{ HostPort: String(port) }] } },
		}),
	);
}

function sidebarRow(page: Page, workstreamId: string) {
	return page.locator(`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`);
}

test('a workstream serves on the ports its repository names and gives them back at archive', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const quiet = await seedWorkstream(page, source, QUIET, 'Quiet');
		const orders = await seedWorkstream(page, source, ORDERS, 'Orders');
		listPorts(quiet.worktree);
		listPorts(orders.worktree);
		await openWorkstream(page, ORDERS);

		const leased = await environmentOfTurn(app, 'PORT_BLOCK');
		expect(leased['MALINI_WORKSTREAM_ID']).toBe(ORDERS);
		const web = Number(leased['MALINI_PORT_WEB']);
		const api = Number(leased['MALINI_PORT_API']);
		expect(web).toBeGreaterThanOrEqual(40_000);
		expect(api).toBeGreaterThan(web);
		expect(api).toBeLessThanOrEqual(48_999);

		const block = page.getByTestId('markdown-code-block').first();
		await block.getByRole('button', { name: 'Run command' }).click();
		await expect(block.getByRole('log', { name: 'Output' })).toContainText(
			`web on ${web} in ${ORDERS}`,
			{ timeout: 20_000 },
		);

		servesOn(app, web);
		await openWorkstream(page, QUIET);
		const row = sidebarRow(page, ORDERS);
		await expect(row).toContainText('Running: web', { timeout: 20_000 });
		await row.hover();
		const card = page.getByTestId('workstream-running-card');
		await expect(card.getByRole('button', { name: `Open web on localhost:${web}` })).toHaveText(
			`web :${web}`,
		);
		await captureFlow(app, 'named-port-card');
		await page.keyboard.press('Escape');

		await page.mouse.move(0, 0);
		const archive = page.locator(
			`[data-testid="sidebar-archive-workstream"][data-workstream-id="${ORDERS}"]`,
		);
		await clickRevealedOnHover(row, archive);
		await expect(row).toHaveCount(0);
		await expect.poll(() => existsSync(orders.worktree), { timeout: 30_000 }).toBe(false);

		await openWorkstream(page, QUIET);
		const reused = await environmentOfTurn(app, 'PORT_BLOCK');
		expect(reused).toEqual({
			MALINI_WORKSTREAM_ID: QUIET,
			MALINI_PORT_WEB: String(web),
			MALINI_PORT_API: String(api),
		});
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
