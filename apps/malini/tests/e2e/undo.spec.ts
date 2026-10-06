import { expect, test } from '@playwright/test';
import {
	captureFlow,
	snapshotRefs,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	listEvents,
	openWorkstream,
	seedTwoChats,
	undoRun,
	visibleRunIds,
} from './harness';

test('undo rewinds the worktree, supersedes A, and obsoletes B without deleting', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId, worktree, chatA, chatB } = await seedTwoChats(
			page,
			source,
			'e2e-undo-ws',
			'Undo workstream',
		);

		const refsBefore = await snapshotRefs(worktree);
		expect(refsBefore.length).toBeGreaterThan(0);
		const eventsBefore =
			(await listEvents(page, chatA)).length + (await listEvents(page, chatB)).length;

		await openWorkstream(page, workstreamId, chatA);
		const [runA] = await visibleRunIds(page);
		if (!runA) throw new Error('chat A has no run to undo');
		await undoRun(page, runA);
		await expect(page.getByTestId('chat-show-undone-toggle')).toBeVisible({ timeout: 30_000 });

		const eventsAfter =
			(await listEvents(page, chatA)).length + (await listEvents(page, chatB)).length;
		expect(eventsAfter).toBeGreaterThan(eventsBefore);

		const refsAfter = await snapshotRefs(worktree);
		expect(refsAfter.length).toBeGreaterThanOrEqual(refsBefore.length);
		for (const ref of refsBefore) expect(refsAfter).toContain(ref);

		expect(await visibleRunIds(page)).toEqual([]);

		const eventsA = await listEvents(page, chatA);
		expect(eventsA.some((entry) => entry.event.type === 'turn.superseded')).toBe(true);

		const eventsB = await listEvents(page, chatB);
		expect(eventsB.some((entry) => entry.event.type === 'run.obsoleted')).toBe(true);

		await openWorkstream(page, workstreamId, chatB);
		await expect(page.getByTestId('chat-run-obsoleted-note')).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId('chat-run-undo-arm')).toHaveCount(0);

		await captureFlow(app, 'flow-1-undo');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
