import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	fileExists,
	launchMalini,
	listEvents,
	openWorkstream,
	seedTwoChats,
	undoRun,
	visibleRunIds,
} from './harness';

test('redo restores the worktree, A talk, and B run without an event gap', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId, worktree, chatA, chatB } = await seedTwoChats(
			page,
			source,
			'e2e-redo-ws',
			'Redo workstream',
		);

		await openWorkstream(page, workstreamId, chatA);
		const [runA] = await visibleRunIds(page);
		if (!runA) throw new Error('chat A has no run to undo');
		await undoRun(page, runA);
		await expect(page.getByTestId('chat-redo-undo')).toBeVisible({ timeout: 30_000 });
		expect(fileExists(join(worktree, 'a.txt'))).toBe(false);
		expect(fileExists(join(worktree, 'b.txt'))).toBe(false);

		await page.getByTestId('chat-redo-undo').click();
		await expect.poll(() => visibleRunIds(page), { timeout: 30_000 }).toHaveLength(1);
		expect(fileExists(join(worktree, 'a.txt'))).toBe(true);
		expect(fileExists(join(worktree, 'b.txt'))).toBe(true);
		await expect(page.getByTestId('chat-redo-undo')).toHaveCount(0);

		const eventsA = await listEvents(page, chatA);
		const superseded = eventsA.find((entry) => entry.event.type === 'turn.superseded');
		const restored = eventsA.find((entry) => entry.event.type === 'turn.restored');
		expect(superseded).toBeTruthy();
		expect(restored).toBeTruthy();
		expect(restored?.event['fromSeq']).toBe(superseded?.event['fromSeq']);
		expect(restored?.event['toSeq']).toBe(superseded?.event['toSeq']);

		const eventsB = await listEvents(page, chatB);
		expect(eventsB.some((entry) => entry.event.type === 'run.restored')).toBe(true);

		await openWorkstream(page, workstreamId, chatB);
		await expect(page.getByTestId('chat-run-obsoleted-note')).toHaveCount(0);

		await captureFlow(app, 'flow-3-redo');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
