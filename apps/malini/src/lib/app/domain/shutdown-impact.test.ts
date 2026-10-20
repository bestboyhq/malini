import { describe, expect, it } from 'vitest';
import type { ShutdownImpact } from '$contract/system';
import { shutdownImpactLines } from './shutdown-impact';

function impact(overrides: Partial<ShutdownImpact> = {}): ShutdownImpact {
	return { agentRuns: 0, containers: 0, ...overrides };
}

describe('shutdownImpactLines', () => {
	it('names the containers a close stops, ranked second behind the agent runs', () => {
		const lines = shutdownImpactLines(impact({ agentRuns: 1, containers: 2 }));

		expect(lines.map((line) => line.key)).toEqual(['agentRuns', 'containers']);
		expect(lines[1]).toEqual({
			key: 'containers',
			count: 2,
			noun: 'containers',
			consequence: 'are stopped and removed',
		});
	});

	it('says a single container is stopped and removed', () => {
		expect(shutdownImpactLines(impact({ containers: 1 }))[0]).toEqual({
			key: 'containers',
			count: 1,
			noun: 'container',
			consequence: 'is stopped and removed',
		});
	});

	it('says nothing about a count of zero', () => {
		expect(shutdownImpactLines(impact())).toEqual([]);
	});
});
