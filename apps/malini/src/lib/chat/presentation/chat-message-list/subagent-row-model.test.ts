import { describe, expect, it } from 'vitest';
import type { SubagentTimelineItem } from '../run-timeline';
import { subagentGroupMeta, subagentGroupTicker } from './subagent-row-model';

function agent(startedAt: number, completedAt: number | null, steps: number): SubagentTimelineItem {
	return {
		kind: 'subagent',
		key: `agent-${startedAt}`,
		seq: startedAt,
		tool: {
			name: 'Agent',
			startedAt,
			completedAt,
			input: {},
			output: undefined,
			status: completedAt === null ? 'running' : 'completed',
		},
		steps: Array.from({ length: steps }, (_, index) => ({
			kind: 'tool',
			key: `step-${startedAt}-${index}`,
			seq: startedAt + index,
			tool: {
				name: 'Read',
				startedAt: null,
				completedAt: null,
				input: {},
				output: undefined,
				status: 'completed',
			},
		})),
		report: null,
	};
}

describe('subagent group line', () => {
	it('counts the agents back and ticks from the first start while any runs', () => {
		const agents = [agent(1_000, 8_400, 4), agent(1_500, null, 2)];
		expect(subagentGroupTicker(agents)).toBe('1 of 2 back');
		expect(subagentGroupMeta(agents, 12_900, false)).toBe('11s');
		expect(subagentGroupMeta(agents, 12_900, true)).toBe('waiting');
	});

	it('sums the steps and spans the first start to the last end once all are back', () => {
		const agents = [agent(1_000, 8_400, 4), agent(1_500, 14_200, 10), agent(1_200, 11_600, 7)];
		expect(subagentGroupTicker(agents)).toBe('3 of 3 back');
		expect(subagentGroupMeta(agents, 20_000, false)).toBe('21 steps · 13.2s');
	});
});
