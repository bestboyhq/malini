import { describe, expect, it } from 'vitest';
import { savedWidget } from './saved-widget';

const INPUT = {
	id: 'open-prs',
	title: 'Open pull requests',
	scope: 'own',
	source: { github: 'repos/a/b/pulls', select: 'length' },
	refresh: { every: 600 },
};

describe('savedWidget', () => {
	it('draws the call input while the tool runs', () => {
		const saved = savedWidget(INPUT, null);
		expect(saved.widget).toMatchObject({
			id: 'open-prs',
			scope: 'own',
			source: { kind: 'github', path: 'repos/a/b/pulls', select: 'length' },
			refresh: { everySeconds: 600, on: [] },
			origin: 'mine',
		});
		expect(saved.reading).toBeNull();
	});

	it('takes the saved widget and its first reading from the result', () => {
		const source = {
			kind: 'http',
			url: 'https://us.posthog.com/api/projects/1/query/',
			method: 'POST',
			headers: { Authorization: 'Bearer ${POSTHOG_KEY}' },
			body: { query: { kind: 'HogQLQuery', query: 'select 1' } },
			keyUrl: 'https://us.posthog.com/settings/user-api-keys',
			select: '.results',
		};
		const output = JSON.stringify({
			widget: {
				id: 'open-prs',
				title: 'Open PRs',
				source,
				refresh: { everySeconds: 120, on: ['push'] },
				fingerprint: 'abc',
				origin: 'mine',
			},
			reading: {
				board: 'b',
				data: null,
				error: 'Needs POSTHOG_KEY. Malini sends it only to us.posthog.com.',
				need: { missing: ['POSTHOG_KEY'] },
			},
		});
		const saved = savedWidget(INPUT, output);
		expect(saved.widget).toMatchObject({
			title: 'Open PRs',
			source,
			refresh: { everySeconds: 120, on: ['push'] },
			fingerprint: 'abc',
		});
		expect(saved.reading).toMatchObject({
			widgetId: 'open-prs',
			need: { missing: ['POSTHOG_KEY'] },
			reading: false,
		});
	});

	it('draws an http source from the call input', () => {
		const input = {
			title: 'Visitors',
			source: { http: { url: 'https://api.example.com/visits', method: 'post' }, select: '.x' },
		};
		expect(savedWidget(input, null).widget?.source).toEqual({
			kind: 'http',
			url: 'https://api.example.com/visits',
			method: 'POST',
			headers: {},
			body: null,
			keyUrl: null,
			select: '.x',
		});
	});

	it('names an MCP or script source from an older call as retired', () => {
		const mcp = { title: 'Visitors', source: { mcp: { server: 'posthog', tool: 'query-trends' } } };
		expect(savedWidget(mcp, null).widget?.source).toEqual({
			kind: 'retired',
			line: 'posthog · query-trends',
		});
		const script = { title: 'Tests', source: { command: './count.sh' } };
		expect(savedWidget(script, null).widget?.source).toEqual({
			kind: 'retired',
			line: 'Runs ./count.sh',
		});
	});

	it('falls back to the input when the result is not JSON', () => {
		expect(savedWidget(INPUT, 'Tool failed').widget?.title).toBe('Open pull requests');
	});

	it('draws nothing without a title or a source', () => {
		expect(savedWidget({ title: 'No source' }, null).widget).toBeNull();
	});
});
