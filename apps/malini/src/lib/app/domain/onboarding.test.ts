import { describe, expect, it } from 'vitest';
import {
	claudeCodeOnboardingStatus,
	onboardingToolsSettled,
	onboardingToolsSkippable,
	openOnboardingTool,
} from './onboarding';

describe('onboarding tools', () => {
	it('opens the first tool that still needs the user', () => {
		expect(openOnboardingTool({ 'claude-code': 'missing', github: 'signed-out' }, null)).toBe(
			'claude-code',
		);
		expect(openOnboardingTool({ 'claude-code': 'ready', github: 'signed-out' }, null)).toBe(
			'github',
		);
	});

	it('opens the tool the user picked until it is ready', () => {
		expect(openOnboardingTool({ 'claude-code': 'missing', github: 'signed-out' }, 'github')).toBe(
			'github',
		);
		expect(openOnboardingTool({ 'claude-code': 'missing', github: 'ready' }, 'github')).toBe(
			'claude-code',
		);
	});

	it('opens nothing while an earlier tool is still being checked', () => {
		expect(openOnboardingTool({ 'claude-code': 'checking', github: 'signed-out' }, null)).toBe(
			null,
		);
		expect(openOnboardingTool({ 'claude-code': 'ready', github: 'checking' }, null)).toBe(null);
	});

	it('opens nothing and settles once every tool is ready', () => {
		const statuses = { 'claude-code': 'ready', github: 'ready' } as const;
		expect(openOnboardingTool(statuses, null)).toBe(null);
		expect(onboardingToolsSettled(statuses)).toBe(true);
		expect(onboardingToolsSettled({ 'claude-code': 'ready', github: 'signed-out' })).toBe(false);
		expect(onboardingToolsSettled({ 'claude-code': 'checking', github: 'ready' })).toBe(false);
	});

	it('settles when a tool cannot be checked, so a failed check never traps the user', () => {
		expect(onboardingToolsSettled({ 'claude-code': 'ready', github: 'unknown' })).toBe(true);
	});

	it('lets the user skip past a tool that is missing or signed out, never past a check', () => {
		expect(onboardingToolsSkippable({ 'claude-code': 'missing', github: 'ready' })).toBe(true);
		expect(onboardingToolsSkippable({ 'claude-code': 'ready', github: 'missing' })).toBe(true);
		expect(onboardingToolsSkippable({ 'claude-code': 'checking', github: 'signed-out' })).toBe(
			true,
		);
		expect(onboardingToolsSkippable({ 'claude-code': 'checking', github: 'ready' })).toBe(false);
		expect(onboardingToolsSkippable({ 'claude-code': 'ready', github: 'unknown' })).toBe(false);
	});

	it('takes an installed Claude Code as done, signed in or not, but never a missing one', () => {
		expect(claudeCodeOnboardingStatus('signed-out')).toBe('ready');
		expect(claudeCodeOnboardingStatus('ready')).toBe('ready');
		expect(claudeCodeOnboardingStatus('missing')).toBe('missing');
		expect(claudeCodeOnboardingStatus('checking')).toBe('checking');
	});
});
