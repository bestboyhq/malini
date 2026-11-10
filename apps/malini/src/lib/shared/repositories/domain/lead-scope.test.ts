import { describe, expect, it } from 'vitest';
import { LEAD_SPACE_PROJECT_ID, isRetiredHomeChat, parseLeadScope } from './lead-scope';

describe('isRetiredHomeChat', () => {
	it('marks a lead-space chat whose scope is the retired home scope', () => {
		expect(
			isRetiredHomeChat({ projectId: LEAD_SPACE_PROJECT_ID, scope: parseLeadScope('home') }),
		).toBe(true);
	});

	it('keeps organization chats and repository work', () => {
		expect(
			isRetiredHomeChat({ projectId: LEAD_SPACE_PROJECT_ID, scope: parseLeadScope('owner:acme') }),
		).toBe(false);
		expect(isRetiredHomeChat({ projectId: 'acme-api', scope: null })).toBe(false);
	});
});
