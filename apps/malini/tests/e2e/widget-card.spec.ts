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

test('a widget the agent saves shows in the chat in its three sizes, and Pin puts it on the board at the size you pick, where its command runs', async () => {
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
				input: {
					id: 'rooms',
					title: 'Rooms',
					icon: 'users',
					source: { command: RUN },
					size: 'medium',
					sample: { value: 3, unit: 'rooms', caption: 'open now' },
				},
			}),
		);

		await sendPrompt(page, 'MALINI_TOOL');
		const card = page.getByRole('region', { name: 'Rooms widget' });
		const pin = card.getByRole('button', { name: 'Pin to my panel' });
		await expect(pin).toBeEnabled({ timeout: 20_000 });
		const sizes = card.getByRole('radiogroup', { name: 'Size' });
		await expect(sizes.getByRole('radio')).toHaveText(['Small', 'Medium', 'Large']);
		await expect(sizes.getByRole('radio', { name: 'Medium' })).toBeChecked();
		await expect(card.getByRole('article', { name: 'Rooms, Medium' })).toContainText('3');
		await expect(card).toContainText(`Malini runs ${RUN} once you pin it`);
		await captureFlow(app, 'widget-card-gallery');

		await sizes.getByRole('radio', { name: 'Large' }).click();
		await expect(sizes.getByRole('radio', { name: 'Large' })).toBeChecked();
		await expect(card.getByRole('article', { name: 'Rooms, Large' })).toBeVisible();
		await pin.click();

		await expect(card.getByText('On your panel')).toBeVisible();
		const board = page.getByRole('region', { name: 'Widgets' });
		await expect(board.getByRole('article', { name: 'Rooms, Large' })).toContainText('5', {
			timeout: 20_000,
		});
		const placements = async () =>
			(await invoke<WidgetBoard>(page, 'widgets.board', { workstreamId })).placements;
		expect(await placements()).toContainEqual({ widgetId: 'rooms', size: 'large', approved: true });
		await captureFlow(app, 'widget-card-pinned');

		await card.getByRole('button', { name: 'Remove' }).click();
		await expect(pin).toBeEnabled();
		expect((await placements()).map(({ widgetId }) => widgetId)).not.toContain('rooms');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
