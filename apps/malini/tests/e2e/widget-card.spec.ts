import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { WidgetBoard } from '../../src/contract/widgets';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	invoke,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

const RUN = `echo '{"value":5,"unit":"rooms","caption":"open now"}'`;

test('a widget the agent saves lands first on the board at two by one, where its command runs, and the chat card removes it', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const { workstreamId } = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-widget-card',
			'Widget card',
		);
		await openWorkstream(page, workstreamId);
		writeFileSync(
			join(app.home, 'malini-tool.json'),
			JSON.stringify({
				tool: 'widgets_save',
				input: { id: 'rooms', title: 'Rooms', icon: 'users', source: { command: RUN } },
			}),
		);

		await sendPrompt(page, 'MALINI_TOOL');
		const card = page.getByRole('region', { name: 'Rooms widget' });
		await expect(card.getByText('On your board')).toBeVisible({ timeout: 20_000 });
		await expect(card.getByRole('article', { name: 'Rooms, 2 by 1' })).toContainText('5');
		await expect(card).toContainText(`Runs ${RUN}`);
		const board = page.getByRole('region', { name: 'Widgets' });
		await expect(board.getByRole('article', { name: 'Rooms, 2 by 1' })).toContainText('5', {
			timeout: 20_000,
		});
		const placements = async () =>
			(await invoke<WidgetBoard>(page, 'widgets.board', { workstreamId })).placements;
		expect(await placements()).toEqual([{ widgetId: 'rooms', span: { columns: 2, rows: 1 } }]);
		await captureFlow(app, 'widget-card-on-board');

		await card.getByRole('button', { name: 'Remove' }).click();
		await expect(card.getByText('Removed from your board')).toBeVisible();
		await expect(board.getByRole('article', { name: /^Rooms, / })).toHaveCount(0);
		expect(await placements()).toEqual([]);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
