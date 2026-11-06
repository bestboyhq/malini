import { describe, expect, it } from 'vitest';
import { automationsView } from './automations-view';

describe('automationsView', () => {
	it('opens Activity, Explorer and Recipes on their routes and the overview everywhere else', () => {
		expect(automationsView('/automations/activity')).toBe('activity');
		expect(automationsView('/automations/explorer')).toBe('explorer');
		expect(automationsView('/automations/recipes')).toBe('recipes');
		expect(automationsView('/automations')).toBe('overview');
		expect(automationsView('/automations/[automationId]')).toBe('overview');
		expect(automationsView('/automations/routines')).toBe('overview');
		expect(automationsView(null)).toBe('overview');
	});
});
