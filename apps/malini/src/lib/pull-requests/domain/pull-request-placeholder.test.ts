import { describe, expect, it } from 'vitest';
import { pullRequestPlaceholderLabel } from './pull-request-placeholder';

describe('the placeholder the top bar holds before a workstream status is known', () => {
	it('is shaped like the action the polled pull request state points at', () => {
		expect(pullRequestPlaceholderLabel('draft', true)).toBe('Ready for review');
		expect(pullRequestPlaceholderLabel('open', false)).toBe('Open PR');
		expect(pullRequestPlaceholderLabel('failing', false)).toBe('Fix errors');
		expect(pullRequestPlaceholderLabel('ready', false)).toBe('Merge');
	});

	it('is shaped like publishing, or absent with nothing to publish, when no pull request is open', () => {
		expect(pullRequestPlaceholderLabel('none', true)).toBe('Commit and push');
		expect(pullRequestPlaceholderLabel('none', false)).toBeNull();
		expect(pullRequestPlaceholderLabel('merged', false)).toBeNull();
		expect(pullRequestPlaceholderLabel('unknown', true)).toBe('Commit and push');
	});
});
