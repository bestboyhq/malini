import { describe, expect, it } from 'vitest';
import { WIDGET_SIZE_SPANS, type WidgetDefinition, type WidgetSource } from '$contract/widgets';
import { runsLabel, sourceLine, tileName, updatedLabel, widgetValue } from './widget-text';

const NOW = new Date('2026-11-22T12:00:00Z');

function widget(source: WidgetSource): WidgetDefinition {
	return {
		id: 'ci',
		title: 'CI',
		icon: null,
		scope: 'shared',
		source,
		refresh: { everySeconds: 300, on: [] },
		size: 'medium',
		url: null,
		author: null,
		fingerprint: '',
		path: null,
	};
}

describe('updatedLabel', () => {
	it('counts minutes, hours and days since the read', () => {
		expect(updatedLabel('2026-11-22T11:59:30Z', NOW)).toBe('Updated just now');
		expect(updatedLabel('2026-11-22T11:58:00Z', NOW)).toBe('Updated 2 min ago');
		expect(updatedLabel('2026-11-22T09:00:00Z', NOW)).toBe('Updated 3 h ago');
		expect(updatedLabel('2026-11-20T12:00:00Z', NOW)).toBe('Updated 2 d ago');
	});

	it('says so when there is no read', () => {
		expect(updatedLabel(null, NOW)).toBe('Not read yet');
		expect(updatedLabel('soon', NOW)).toBe('Not read yet');
	});
});

describe('sourceLine', () => {
	it('names where the numbers come from', () => {
		expect(sourceLine(widget({ kind: 'github', path: 'repos/a/b/pulls', select: null }))).toBe(
			'gh api repos/a/b/pulls',
		);
		expect(sourceLine(widget({ kind: 'github', path: 'repos/a/b', select: '.x' }))).toBe(
			"gh api repos/a/b --jq '.x'",
		);
		expect(sourceLine(widget({ kind: 'command', run: 'pnpm test' }))).toBe('Runs pnpm test');
		expect(sourceLine(widget({ kind: 'plan' }))).toBe('Your plan');
	});
});

describe('tile text', () => {
	it('names the tile with its preset, or with its cells when it fits no preset', () => {
		expect(tileName(widget({ kind: 'plan' }), WIDGET_SIZE_SPANS.large, 4)).toBe('CI, Large');
		expect(tileName(widget({ kind: 'plan' }), { columns: 3, rows: 2 }, 4)).toBe('CI, 3 by 2');
		expect(tileName(widget({ kind: 'plan' }), { columns: 3, rows: 3 }, 2)).toBe('CI, 2 by 3');
	});

	it('formats numbers and keeps text', () => {
		expect(widgetValue(12345.678)).toBe('12,345.68');
		expect(widgetValue('v2')).toBe('v2');
	});

	it('counts failed runs', () => {
		expect(runsLabel(['success'])).toBe('1 run. None failed');
		expect(runsLabel(['success', 'failure', 'failure'])).toBe('3 runs. 2 failed');
	});
});
