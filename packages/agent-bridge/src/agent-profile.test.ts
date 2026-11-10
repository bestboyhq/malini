import { describe, expect, it } from 'vitest';
import { isAgentLineage } from './agent-profile.js';

describe('isAgentLineage', () => {
	const lead = { owner: 'acme', repositories: [], workstreams: [], plan: '/plans/p.md' };
	const lineage = (override: Record<string, unknown>) => ({
		lead: { ...lead, ...override },
		startedBy: null,
		siblings: [],
	});

	it('accepts a lead chat of an organization', () => {
		expect(isAgentLineage(lineage({}))).toBe(true);
	});

	it('rejects a lead chat with a null, empty or missing owner', () => {
		expect(isAgentLineage(lineage({ owner: null }))).toBe(false);
		expect(isAgentLineage(lineage({ owner: '' }))).toBe(false);
		expect(isAgentLineage(lineage({ owner: undefined }))).toBe(false);
	});
});
