import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MainContext } from '$main/context';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { registerScratchpad } from './register';

const IDEA = JSON.stringify({
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Try a slash menu' }] }],
});

let context: MainContext;

beforeEach(() => {
	context = {
		db: openMigratedDatabase(':memory:'),
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: '/tmp/malini',
		resourcesRoot: '/tmp/malini',
		isDev: false,
		appVersion: '0.0.0',
	};
	registerScratchpad(context);
});

afterEach(() => context.db.close());

describe('a repository scratchpad', () => {
	it('starts empty and keeps the last saved document under the repository name', async () => {
		expect(
			await context.commands.call('scratchpad.load', { repositoryFullName: 'bestboyhq/malini' }),
		).toBeNull();

		await context.commands.call('scratchpad.save', {
			repositoryFullName: 'bestboyhq/malini',
			content: JSON.stringify({ type: 'doc' }),
		});
		await context.commands.call('scratchpad.save', {
			repositoryFullName: 'BestBoyHQ/Malini',
			content: IDEA,
		});

		expect(
			await context.commands.call('scratchpad.load', { repositoryFullName: 'bestboyhq/malini' }),
		).toBe(IDEA);
		expect(
			await context.commands.call('scratchpad.load', { repositoryFullName: 'bestboyhq/grip' }),
		).toBeNull();
	});

	it('refuses a nameless repository and content that is not a document', async () => {
		const save = (args: unknown): Promise<unknown> =>
			context.commands.invoke({ command: 'scratchpad.save', args });

		await expect(save({ repositoryFullName: ' ', content: IDEA })).resolves.toMatchObject({
			ok: false,
			error: expect.stringMatching(/repositoryFullName/u),
		});
		for (const content of ['not json', '[]', JSON.stringify({ type: 'paragraph' }), 7]) {
			await expect(
				save({ repositoryFullName: 'bestboyhq/malini', content }),
			).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/content/u) });
		}
		expect(
			await context.commands.call('scratchpad.load', { repositoryFullName: 'bestboyhq/malini' }),
		).toBeNull();
	});
});
