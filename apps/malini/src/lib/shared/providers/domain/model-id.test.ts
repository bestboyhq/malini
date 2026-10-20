import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_MODEL, claudeModelFor, isValidAgentModel } from './model-id';

describe('Claude Code model ids', () => {
	it('accepts Claude Code aliases and full ids and rejects anything else', () => {
		for (const model of ['opus', 'opus[1m]', 'sonnet[1m]', 'claude-opus-5-5']) {
			expect(isValidAgentModel(model)).toBe(true);
		}
		for (const model of [
			'default',
			'anthropic/claude-sonnet-4-6',
			'vendor/model-5',
			'Opus',
			'',
			'a?b',
		]) {
			expect(isValidAgentModel(model)).toBe(false);
		}
		expect(isValidAgentModel(`a${'b'.repeat(128)}`)).toBe(false);
	});

	it('moves models persisted before Claude Code to the matching family or the default', () => {
		expect(claudeModelFor('anthropic/claude-opus-4-8')).toBe('opus');
		expect(claudeModelFor('anthropic/claude-sonnet-4-6')).toBe('sonnet');
		expect(claudeModelFor('anthropic/claude-haiku-4-5')).toBe('haiku');
		expect(claudeModelFor('anthropic/claude-fable-5')).toBe(DEFAULT_AGENT_MODEL);
		expect(claudeModelFor('vendor/model-6')).toBe(DEFAULT_AGENT_MODEL);
		expect(claudeModelFor(null)).toBe(DEFAULT_AGENT_MODEL);
		expect(claudeModelFor('default')).toBe('opus');
		expect(claudeModelFor('sonnet[1m]')).toBe('sonnet[1m]');
	});
});
