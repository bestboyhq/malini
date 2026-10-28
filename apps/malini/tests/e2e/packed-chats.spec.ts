import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';
import type { ArchivedWorkstreamDto } from '../../src/contract/repositories';
import {
	captureFlow,
	clickRevealedOnHover,
	createSourceRepo,
	currentSessionId,
	expectCleanConsole,
	invoke,
	launchMalini,
	listEvents,
	openWorkstream,
	seedTwoChats,
	seedWorkstream,
	selectChat,
	sendPrompt,
	type LaunchedApp,
} from './harness';

const LATEST_RUN = '[data-testid="chat-message-list"] > li[data-run-id]:last-child';
const BUILD_LINES = 5_000;

function storedToolEvents(app: LaunchedApp, sessionId: string): { packs: number; loose: number } {
	const db = new DatabaseSync(join(app.userDataDir, 'malini.sqlite'), { readOnly: true });
	try {
		const count = (sql: string): number => Number(db.prepare(sql).get(sessionId)?.['count']);
		return {
			packs: count('SELECT COUNT(*) AS count FROM agent_event_packs WHERE session_id = ?'),
			loose: count(
				"SELECT COUNT(*) AS count FROM agent_events WHERE session_id = ? AND event LIKE 'tool.%'",
			),
		};
	} finally {
		db.close();
	}
}

async function runBuild(page: Page): Promise<string> {
	await sendPrompt(page, `BIG_BASH:${BUILD_LINES}`);
	await expect(page.locator(LATEST_RUN)).toHaveAttribute('data-run-terminal', 'completed', {
		timeout: 30_000,
	});
	const sessionId = currentSessionId(page);
	if (sessionId === null) throw new Error('the chat has no session id');
	return sessionId;
}

test('an archived workstream packs its chat history and shows the full tool output again once restored', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		await seedWorkstream(page, source, 'e2e-packed-other', 'Other work');
		const seeded = await seedWorkstream(page, source, 'e2e-packed-ws', 'Packed work');
		await openWorkstream(page, seeded.workstreamId);
		const sessionId = await runBuild(page);
		expect(storedToolEvents(app, sessionId)).toEqual({ packs: 0, loose: 2 });

		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		const row = sidebar.locator(
			`[data-testid="sidebar-workstream"][data-workstream-id="${seeded.workstreamId}"]`,
		);
		await clickRevealedOnHover(
			row,
			sidebar.locator(
				`[data-testid="sidebar-archive-workstream"][data-workstream-id="${seeded.workstreamId}"]`,
			),
		);
		await expect(row).toHaveCount(0);
		await expect
			.poll(() => storedToolEvents(app, sessionId), { timeout: 30_000 })
			.toEqual({ packs: 1, loose: 0 });

		const [archived] = await invoke<ArchivedWorkstreamDto[]>(
			page,
			'repositories.list-archived-workstreams',
		);
		await clickRevealedOnHover(
			page.locator(
				`[data-testid="sidebar-archived-workstream"][data-workstream-id="${seeded.workstreamId}"]`,
			),
			page.getByRole('button', { name: `Restore ${archived?.name}` }),
		);
		await expect(row).toHaveAttribute('aria-current', 'page', { timeout: 30_000 });
		expect(storedToolEvents(app, sessionId)).toEqual({ packs: 0, loose: 2 });

		await page.locator(LATEST_RUN).getByTestId('bash-command-toggle').click();
		const output = page.locator(LATEST_RUN).getByTestId('command-output-scroll');
		await output.getByRole('button', { name: /Show full output/u }).click();
		await expect(output).toContainText(`build line ${BUILD_LINES}`);
		await captureFlow(app, 'packed-chat-restored');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('closing a chat packs its tool output, keeps it readable, and leaves the open chats alone', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { chatA, chatB } = await seedTwoChats(page, source, 'e2e-packed-close-ws', 'Closed chat');
		await runBuild(page);
		await selectChat(page, chatA);
		await runBuild(page);
		await selectChat(page, chatB);

		await page.keyboard.press('ControlOrMeta+w');
		await expect(
			page.locator(`[data-testid="chat-agent-tab"][data-session-id="${chatB}"]`),
		).toHaveCount(0, { timeout: 20_000 });
		await expect
			.poll(() => storedToolEvents(app, chatB), { timeout: 20_000 })
			.toEqual({ packs: 1, loose: 0 });
		expect(storedToolEvents(app, chatA)).toEqual({ packs: 0, loose: 2 });

		const output = (await listEvents(page, chatB)).find(
			({ event }) => event.type === 'tool.completed',
		)?.event['output'];
		expect(typeof output === 'string' && output.endsWith(`build line ${BUILD_LINES}`)).toBe(true);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
