import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const topBar = readFileSync(new URL('./TopBar.svelte', import.meta.url), 'utf8');

function barActionClickHandler(): string {
	const start = topBar.indexOf('function onBarActionClicked');
	expect(start).toBeGreaterThan(-1);
	return topBar.slice(start, topBar.indexOf('\n\t}', start));
}

describe('top bar confirmation wiring', () => {
	it('renders the pending merge confirmation the status publishes', () => {
		expect(topBar).toContain('githubStatus.mergeConfirmation');
		expect(topBar).toContain('data-testid="global-topbar-merge-confirmation"');
	});

	it('never invokes a confirmable action on its first click', () => {
		const handler = barActionClickHandler();
		expect(handler).toMatch(
			/if \(action\.confirmLabel && armedActionId !== action\.id\) \{[\s\S]*?return;\s*\}/u,
		);
		expect(handler.indexOf('action.onInvoke()')).toBeGreaterThan(handler.indexOf('return;'));
	});

	it('does not disarm a primed confirmation on every status publish', () => {
		const script = topBar.slice(0, topBar.indexOf('</script>'));
		const resets = script.split('armedActionId = null').length - 1;
		expect(resets).toBeGreaterThan(0);
		expect(script).toContain('armedConfirmationSurvives(');
	});
});
