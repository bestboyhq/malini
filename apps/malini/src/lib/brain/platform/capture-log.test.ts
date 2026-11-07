import { describe, expect, it } from 'vitest';
import { capturedChats, logSection, redactBrainText, type TypedPrompt } from './capture-log';

const HOME = '/Users/ada';

function prompt(overrides: Partial<TypedPrompt> & Pick<TypedPrompt, 'seq'>): TypedPrompt {
	return {
		sessionId: 'chat-1',
		runId: `run-${overrides.seq}`,
		chatName: 'Fix the login loop',
		place: 'acme/web',
		text: `Prompt ${overrides.seq}`,
		outcome: null,
		finished: true,
		...overrides,
	};
}

describe('what the brain keeps of a typed prompt', () => {
	it('masks every saved secret value, the longest first, and leaves values too short to mask', () => {
		const redacted = redactBrainText(
			'Deploy with hunter2-prod-key, not hunter2, and keep abc as is',
			HOME,
			['hunter2', 'hunter2-prod-key', 'abc'],
		);
		expect(redacted).toBe('Deploy with [secret], not [secret], and keep abc as is');
	});

	it('drops token shapes, home paths and emails the way diagnostics do', () => {
		const redacted = redactBrainText(
			`Use ghp_${'a'.repeat(36)} from ${HOME}/notes and mail ada@example.com`,
			HOME,
			[],
		);
		expect(redacted).not.toContain('ghp_');
		expect(redacted).not.toContain(HOME);
		expect(redacted).not.toContain('ada@example.com');
		expect(redacted).toContain('[home]/notes');
	});
});

describe('the chats one capture appends', () => {
	it('keeps every prompt of a turn together under its Outcome line', () => {
		const [chat] = capturedChats([
			prompt({ seq: 1, outcome: 'Fixed the redirect.' }),
			prompt({ seq: 2, runId: 'run-1', text: 'Also the logout', outcome: 'Fixed the redirect.' }),
			prompt({ seq: 3, outcome: null }),
		]);
		expect(chat?.lastSeq).toBe(3);
		expect(chat && logSection(chat)).toBe(
			[
				'## Fix the login loop - acme/web',
				'> Prompt 1\n\n> Also the logout\n\nOutcome: Fixed the redirect.',
				'> Prompt 3',
			].join('\n\n'),
		);
	});

	it('quotes every line of a prompt, blank lines included', () => {
		const [chat] = capturedChats([prompt({ seq: 1, text: 'First\n\nSecond' })]);
		expect(chat && logSection(chat)).toBe(
			'## Fix the login loop - acme/web\n\n> First\n>\n> Second',
		);
	});

	it('stops a chat at its first unfinished turn so its outcome lands on the next capture', () => {
		const chats = capturedChats([
			prompt({ seq: 1 }),
			prompt({ seq: 2, sessionId: 'chat-2', chatName: '', place: 'Home', finished: false }),
			prompt({ seq: 3, finished: false }),
			prompt({ seq: 4 }),
		]);
		expect(chats).toHaveLength(1);
		expect(chats[0]?.lastSeq).toBe(1);
		expect(chats[0]?.turns).toHaveLength(1);
	});

	it('names an unnamed chat', () => {
		const [chat] = capturedChats([prompt({ seq: 1, chatName: '  ', place: 'Home' })]);
		expect(chat?.heading).toBe('Untitled chat - Home');
	});
});
