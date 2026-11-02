import { describe, expect, it } from 'vitest';
import { openMigratedDatabase } from '$main/db/open';
import { listStoredProviders } from './provider.repository';
import { ModelsDevCatalog, type CatalogFetch } from './models-dev.service';

const HOUR = 60 * 60 * 1000;

const catalog = {
	'opencode-go': {
		models: {
			'glm-9': {
				id: 'glm-9',
				name: 'GLM-9',
				tool_call: true,
				reasoning: false,
				modalities: { input: ['text'], output: ['text'] },
				limit: { context: 200_000 },
				cost: { input: 1, output: 2 },
			},
		},
	},
};

function harness(replies: Array<() => Response>) {
	const db = openMigratedDatabase(':memory:');
	const requests: Array<Record<string, string>> = [];
	let clock = 0;
	const fetch: CatalogFetch = async (_url, init) => {
		requests.push(Object.fromEntries(new Headers(init.headers)));
		const reply = replies.shift();
		if (!reply) throw new Error('offline');
		return reply();
	};
	const models = new ModelsDevCatalog({ db, fetch, url: 'http://models.test', now: () => clock });
	const modelIds = (id: string) =>
		listStoredProviders(db)
			.find((provider) => provider.id === id)
			?.models.map((model) => model.id);
	return {
		models,
		requests,
		modelIds,
		advance: (ms: number) => {
			clock += ms;
		},
	};
}

describe('ModelsDevCatalog', () => {
	it('replaces the models of a provider with the ones models.dev lists and keeps the rest', async () => {
		const { models, modelIds } = harness([
			() => Response.json(catalog, { headers: { etag: '"v1"' } }),
		]);
		await models.refresh();
		expect(modelIds('opencode-go')).toEqual(['glm-9']);
		expect(modelIds('deepseek')).toEqual(['deepseek-v4-pro', 'deepseek-flash']);
	});

	it('asks once an hour and sends the ETag it got last', async () => {
		const { models, requests, advance, modelIds } = harness([
			() => Response.json(catalog, { headers: { etag: '"v1"' } }),
			() => new Response(null, { status: 304 }),
		]);
		await models.refresh();
		await models.refresh();
		expect(requests).toEqual([{}]);
		advance(HOUR);
		await models.refresh();
		expect(requests).toEqual([{}, { 'if-none-match': '"v1"' }]);
		expect(modelIds('opencode-go')).toEqual(['glm-9']);
	});

	it('asks again on the next refresh when models.dev did not answer', async () => {
		const { models, requests, modelIds } = harness([
			() => {
				throw new Error('offline');
			},
			() => new Response('busy', { status: 503 }),
			() => Response.json(catalog),
		]);
		await models.refresh();
		await models.refresh();
		await models.refresh();
		await models.refresh();
		expect(requests).toHaveLength(3);
		expect(modelIds('opencode-go')).toEqual(['glm-9']);
	});

	it('keeps the models it has when models.dev is down or sends something unreadable', async () => {
		const { models, advance, modelIds } = harness([
			() => new Response('not json', { status: 200 }),
			() => new Response('busy', { status: 503 }),
		]);
		const seeded = modelIds('opencode-go');
		await models.refresh();
		advance(HOUR);
		await models.refresh();
		advance(HOUR);
		await models.refresh();
		expect(modelIds('opencode-go')).toEqual(seeded);
		expect(seeded?.length).toBeGreaterThan(0);
	});
});
