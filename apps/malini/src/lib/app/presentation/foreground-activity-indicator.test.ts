import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indicator = readFileSync(
	new URL('./ForegroundActivityIndicator.svelte', import.meta.url),
	'utf8',
);

describe('the foreground activity indicator', () => {
	it('reads the announcement channel and nothing else', () => {
		expect(indicator).toContain("from '$shared/shell/foreground-activity.svelte'");
		expect(indicator).toContain('foregroundActivity.current');
		expect(indicator).toContain('data-testid="foreground-activity-status"');
	});

	it.each([
		'runtimeDiagnostics.active',
		'activity.category',
		'active?.label',
		'active.label',
		"category !== 'navigation'",
	])('never reaches for %s', (banned) => {
		expect(indicator).not.toContain(banned);
	});

	it.each(['runtimeDiagnostics', 'freezes', 'Caught up', 'setInterval'])(
		'never narrates a stall that is already over: %s',
		(banned) => {
			expect(indicator).not.toContain(banned);
		},
	);

	it('reveals an announcement within one frame of the click that caused it', () => {
		expect(indicator).toContain('FIRST_FEEDBACK_BUDGET_MS');
		expect(indicator).toContain('ACTIVITY_REVEAL_DELAY_MS - (monotonicNow() - startedAt)');
	});
});
