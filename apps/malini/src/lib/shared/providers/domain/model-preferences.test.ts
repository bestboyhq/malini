import { describe, expect, it } from 'vitest';
import {
	DEFAULT_MODEL_PREFERENCES,
	isValidModelSelection,
	modelSelectionValue,
	normalizeModelPreferences,
	normalizeModelSelection,
	parseModelSelectionValue,
	preferencesWithRoleSelection,
	roleForAgentMode,
	sameModelSelection,
	selectionForRole,
} from './model-preferences';
import { DEEPSEEK_MODELS, DEEPSEEK_PROVIDER_ID } from './provider';

describe('model preferences', () => {
	it('repairs corrupt values role by role and moves pre-Claude Code models to their family', () => {
		const repaired = normalizeModelPreferences(
			{
				planning: { model: 'anthropic/claude-opus-4-8' },
				implementation: { model: 'vendor/model-5' },
			},
			DEFAULT_MODEL_PREFERENCES,
		);
		expect(repaired.planning).toEqual({ provider: 'claude', model: 'opus' });
		expect(repaired.implementation).toEqual({ provider: 'claude', model: 'opus' });
		expect(
			normalizeModelPreferences(
				{ planning: { model: 'default' }, implementation: { model: 'default' } },
				{
					planning: { provider: 'claude', model: 'fable' },
					implementation: { provider: 'claude', model: 'sonnet' },
				},
			),
		).toEqual({
			planning: { provider: 'claude', model: 'fable' },
			implementation: { provider: 'claude', model: 'sonnet' },
		});
		expect(normalizeModelPreferences('{broken', DEFAULT_MODEL_PREFERENCES)).toEqual(
			DEFAULT_MODEL_PREFERENCES,
		);
	});

	it('infers the provider of a selection stored without one', () => {
		expect(
			normalizeModelSelection({ model: 'deepseek-v4-pro' }, DEFAULT_MODEL_PREFERENCES.planning),
		).toEqual({ provider: DEEPSEEK_PROVIDER_ID, model: 'deepseek-v4-pro' });
		expect(normalizeModelSelection({ model: 'opus' }, DEFAULT_MODEL_PREFERENCES.planning)).toEqual({
			provider: 'claude',
			model: 'opus',
		});
		expect(
			normalizeModelSelection(
				{ provider: DEEPSEEK_PROVIDER_ID, model: 'deepseek-flash' },
				DEFAULT_MODEL_PREFERENCES.planning,
			),
		).toEqual({ provider: DEEPSEEK_PROVIDER_ID, model: 'deepseek-flash' });
		expect(
			normalizeModelSelection(
				{ provider: 'custom', model: 'vendor-model' },
				DEFAULT_MODEL_PREFERENCES.planning,
				[{ id: 'custom', models: ['vendor-model'] }],
			),
		).toEqual({ provider: 'custom', model: 'vendor-model' });
	});

	it('round trips a selection through a select value', () => {
		const selection = { provider: DEEPSEEK_PROVIDER_ID, model: DEEPSEEK_MODELS[0]?.id ?? '' };
		expect(
			parseModelSelectionValue(modelSelectionValue(selection), DEFAULT_MODEL_PREFERENCES.planning),
		).toEqual(selection);
		expect(parseModelSelectionValue('{broken', DEFAULT_MODEL_PREFERENCES.planning)).toEqual(
			DEFAULT_MODEL_PREFERENCES.planning,
		);
	});

	it('maps plan and agent mode to distinct remembered selections', () => {
		const implementation = preferencesWithRoleSelection(
			DEFAULT_MODEL_PREFERENCES,
			'implementation',
			{ provider: 'claude', model: 'sonnet' },
		);
		expect(roleForAgentMode('plan')).toBe('planning');
		expect(roleForAgentMode('agent')).toBe('implementation');
		expect(implementation.planning).toEqual(DEFAULT_MODEL_PREFERENCES.planning);
		expect(selectionForRole(implementation, 'implementation')).toEqual({
			provider: 'claude',
			model: 'sonnet',
		});
	});

	it('compares selections by provider and model', () => {
		expect(
			sameModelSelection(
				{ provider: 'claude', model: 'opus[1m]' },
				{ provider: 'claude', model: 'opus[1m]' },
			),
		).toBe(true);
		expect(
			sameModelSelection(
				{ provider: 'claude', model: 'opus' },
				{ provider: 'deepseek', model: 'opus' },
			),
		).toBe(false);
		expect(
			sameModelSelection(
				{ provider: 'claude', model: 'opus' },
				{ provider: 'claude', model: 'sonnet' },
			),
		).toBe(false);
		expect(isValidModelSelection({ provider: 'claude', model: 'claude-opus-5-5' })).toBe(true);
		expect(isValidModelSelection({ provider: 'claude', model: 'vendor/model-5' })).toBe(false);
		expect(isValidModelSelection({ model: 'claude-opus-5-5' })).toBe(false);
	});
});
