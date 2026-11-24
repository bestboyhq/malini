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
				source: { kind: 'command', run: 'gh pr list' },
				refresh: { everySeconds: 120, on: ['push'] },
				fingerprint: 'abc',
				origin: 'mine',
			},
			reading: { board: 'b', data: { value: 7 }, readAt: '2026-11-22T12:00:00Z' },
		});
		const saved = savedWidget(INPUT, output);
		expect(saved.widget).toMatchObject({
			title: 'Open PRs',
			source: { kind: 'command', run: 'gh pr list' },
			refresh: { everySeconds: 120, on: ['push'] },
			fingerprint: 'abc',
		});
		expect(saved.reading).toMatchObject({ widgetId: 'open-prs', reading: false });
		expect(saved.reading?.data?.value).toBe(7);
	});

	it('falls back to the input when the result is not JSON', () => {
		expect(savedWidget(INPUT, 'Tool failed').widget?.title).toBe('Open pull requests');
	});

	it('draws nothing without a title or a source', () => {
		expect(savedWidget({ title: 'No source' }, null).widget).toBeNull();
	});
});
