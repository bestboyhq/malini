import { describe, expect, it } from 'vitest';
import {
	DEFAULT_MODEL_PREFERENCES,
	isValidModelSelection,
	normalizeModelPreferences,
	preferencesWithRoleSelection,
	roleForAgentMode,
	sameModelSelection,
	selectionForRole,
} from './model-preferences';

describe('model preferences', () => {
	it('repairs corrupt values role by role and moves pre-Claude Code models to their family', () => {
		const repaired = normalizeModelPreferences(
			{
				planning: { model: 'anthropic/claude-opus-4-8' },
				implementation: { model: 'openai/gpt-5.5' },
			},
			DEFAULT_MODEL_PREFERENCES,
		);
		expect(repaired.planning).toEqual({ model: 'opus' });
		expect(repaired.implementation).toEqual({ model: 'default' });
		expect(normalizeModelPreferences('{broken', DEFAULT_MODEL_PREFERENCES)).toEqual(
			DEFAULT_MODEL_PREFERENCES,
		);
	});

	it('maps plan and agent mode to distinct remembered selections', () => {
		const implementation = preferencesWithRoleSelection(
			DEFAULT_MODEL_PREFERENCES,
			'implementation',
			{ model: 'sonnet' },
		);
		expect(roleForAgentMode('plan')).toBe('planning');
		expect(roleForAgentMode('agent')).toBe('implementation');
		expect(implementation.planning).toEqual(DEFAULT_MODEL_PREFERENCES.planning);
		expect(selectionForRole(implementation, 'implementation')).toEqual({ model: 'sonnet' });
	});

	it('compares selections by model alone', () => {
		expect(sameModelSelection({ model: 'opus[1m]' }, { model: 'opus[1m]' })).toBe(true);
		expect(sameModelSelection({ model: 'opus' }, { model: 'sonnet' })).toBe(false);
		expect(isValidModelSelection({ model: 'claude-opus-5-5' })).toBe(true);
		expect(isValidModelSelection({ model: 'openai/gpt-5.5' })).toBe(false);
	});
});
