import { describe, expect, it } from 'vitest';
import { deriveAgentChatDisplayName, runIdForPromptRequest } from './chat-identity';

describe('the run a prompt request names', () => {
	it('names a run after the request that asks for it', () => {
		expect(runIdForPromptRequest('f81d4fae-7dec-11d0-a765-00a0c91e6bf6')).toBe(
			'run-f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
		);
		expect(runIdForPromptRequest('  req_1  ')).toBe('run-req_1');
		expect(runIdForPromptRequest('req_1-A')).toBe('run-req_1-A');
	});

	it('declines a request id the main process would not name a run after', () => {
		expect(runIdForPromptRequest(null)).toBeNull();
		expect(runIdForPromptRequest(undefined)).toBeNull();
		expect(runIdForPromptRequest('')).toBeNull();
		expect(runIdForPromptRequest('   ')).toBeNull();
		expect(runIdForPromptRequest('has space')).toBeNull();
		expect(runIdForPromptRequest('has/slash')).toBeNull();
		expect(runIdForPromptRequest('quote"id')).toBeNull();
	});
});

describe('the name a chat takes from its first prompt', () => {
	it('derives a concise subject from the first prompt', () => {
		expect(
			deriveAgentChatDisplayName(
				'  Could you please fix the refresh token flow before reconnecting? ',
			),
		).toBe('Fix the refresh token flow before reconnecting');
		expect(
			deriveAgentChatDisplayName(
				'Okay, so I want you to make the composer feel dramatically cleaner and faster today',
			),
		).toBe('Make the composer feel dramatically cleaner');
		expect(deriveAgentChatDisplayName(' \n\t ')).toBeNull();
	});

	it('stops before a word that opens a parenthesis or bracket', () => {
		expect(
			deriveAgentChatDisplayName(
				'Review the uncommitted change here (git diff shows it) as a senior engineer',
			),
		).toBe('Review the uncommitted change here');
		expect(deriveAgentChatDisplayName('Fix [PROJ-123] the login flow')).toBe('Fix');
		expect(deriveAgentChatDisplayName('Update dependencies (pnpm update -r)')).toBe(
			'Update dependencies',
		);
	});

	it.each([
		{
			prompt: 'Side question in this branch, do not change any code. Why does the sidebar flicker?',
			name: 'Side question in this branch',
		},
		{
			prompt:
				'Feature: auto workstream naming\n\nToday a new workstream gets a random two-word name until its first prompt.',
			name: 'Auto workstream naming',
		},
		{
			prompt: 'Hey, can you rename the settings page? It reads Preferences today.',
			name: 'Rename the settings page',
		},
		{ prompt: 'Fix the login bug; the token expires too early', name: 'Fix the login bug' },
		{
			prompt: 'Please update hero.ts to use the new tokens',
			name: 'Update hero.ts to use the new tokens',
		},
		{
			prompt: 'Make the sidebar collapse when the window is narrow and keep the state',
			name: 'Make the sidebar collapse when the window',
		},
		{ prompt: 'Run the tests at 10:30 and report back', name: 'Run the tests at 10:30 and report' },
	])('names "$prompt" after its first clause: $name', ({ prompt, name }) => {
		expect(deriveAgentChatDisplayName(prompt)).toBe(name);
	});
});
