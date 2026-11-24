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
		const output = JSON.stringify({
			widget: {
				id: 'open-prs',
				title: 'Open PRs',
				source: {
					kind: 'mcp',
					server: 'posthog',
					tool: 'trend',
					arguments: { days: 7 },
					select: '.value',
					url: null,
				},
				refresh: { everySeconds: 120, on: ['push'] },
				fingerprint: 'abc',
				origin: 'mine',
			},
			reading: { board: 'b', data: null, error: 'posthog needs you to sign in.', need: 'sign-in' },
		});
		const saved = savedWidget(INPUT, output);
		expect(saved.widget).toMatchObject({
			title: 'Open PRs',
			source: {
				kind: 'mcp',
				server: 'posthog',
				tool: 'trend',
				arguments: { days: 7 },
				select: '.value',
				url: null,
			},
			refresh: { everySeconds: 120, on: ['push'] },
			fingerprint: 'abc',
		});
		expect(saved.reading).toMatchObject({ widgetId: 'open-prs', need: 'sign-in', reading: false });
	});

	it('draws an MCP source from the call input', () => {
		const input = {
			title: 'Visitors',
			source: { mcp: { server: 'logdash', tool: 'trend', arguments: { days: 7 } }, select: '.x' },
		};
		expect(savedWidget(input, null).widget?.source).toEqual({
			kind: 'mcp',
			server: 'logdash',
			tool: 'trend',
			arguments: { days: 7 },
			select: '.x',
			url: null,
		});
	});

	it('falls back to the input when the result is not JSON', () => {
		expect(savedWidget(INPUT, 'Tool failed').widget?.title).toBe('Open pull requests');
	});

	it('draws nothing without a title or a source', () => {
		expect(savedWidget({ title: 'No source' }, null).widget).toBeNull();
	});
});
