import { describe, expect, it } from 'vitest';
import { claudeCodeOnboardingStatus, onboardingToolsSettled } from './onboarding';

describe('onboarding tools', () => {
	it('settles once every tool is ready', () => {
		expect(onboardingToolsSettled({ 'claude-code': 'ready', github: 'ready' })).toBe(true);
		expect(onboardingToolsSettled({ 'claude-code': 'ready', github: 'signed-out' })).toBe(false);
		expect(onboardingToolsSettled({ 'claude-code': 'checking', github: 'ready' })).toBe(false);
	});

	it('settles when a tool cannot be checked, so a failed check never traps the user', () => {
		expect(onboardingToolsSettled({ 'claude-code': 'ready', github: 'unknown' })).toBe(true);
	});

	it('takes an installed Claude Code as done, signed in or not, but never a missing one', () => {
		expect(claudeCodeOnboardingStatus('signed-out')).toBe('ready');
		expect(claudeCodeOnboardingStatus('ready')).toBe('ready');
		expect(claudeCodeOnboardingStatus('missing')).toBe('missing');
		expect(claudeCodeOnboardingStatus('checking')).toBe('checking');
	});
});
