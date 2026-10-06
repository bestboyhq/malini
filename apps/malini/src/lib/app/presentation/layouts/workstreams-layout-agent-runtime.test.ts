import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(new URL('./WorkstreamsLayout.svelte', import.meta.url), 'utf8');

describe('cold workstream session bootstrap performance', () => {
	it('prepares the native agent runtime only after the settled shell paint', () => {
		const releasesAt = layout.indexOf('releases.push(');
		const scheduleAt = layout.indexOf('scheduleAfterSettledNavigationPaint(() => {', releasesAt);
		const measureAt = layout.indexOf("label: 'Preparing agent runtime'", scheduleAt);
		const invokeAt = layout.indexOf('loadProviderCapabilitiesCommand()', measureAt);

		expect(releasesAt).toBeGreaterThan(-1);
		expect(scheduleAt).toBeGreaterThan(releasesAt);
		expect(measureAt).toBeGreaterThan(scheduleAt);
		expect(invokeAt).toBeGreaterThan(measureAt);
		expect(layout).toContain('budgetMs: PERFORMANCE_BUDGETS.agentSessionStartMs');
		expect(layout).toContain('for (const release of releases.splice(0).reverse()) release();');
	});
});
