import { describe, expect, it } from 'vitest';
import { AGENT_REPORTS, type AgentReport } from '../agent-profile.js';
import { systemPromptAppend } from './instructions.js';

const BODY_RULES: Record<AgentReport, string> = {
	low: 'show, do not tell',
	medium: 'each one line of at most 80 characters starting with `Changed:` or `Verified:`',
	high: 'the full write-up',
};

describe('systemPromptAppend', () => {
	it.each(AGENT_REPORTS)('asks for the %s report body and the turn footer', (report) => {
		const prompt = systemPromptAppend('/nonexistent/worktree', report);

		expect(prompt).toContain(`at the ${report} report resolution`);
		for (const other of AGENT_REPORTS) {
			expect(prompt.includes(BODY_RULES[other])).toBe(other === report);
		}
		expect(prompt).toContain(
			[
				'Outcome: <one sentence of at most 60 characters: what is true now>',
				'Needs: <what blocks this work that only the user can do, several separated by "; ", or "nothing">',
				'Commit: <subject>',
				'Pull request: <title>',
			].join('\n'),
		);
		expect(prompt).toContain(
			'only answers a question or talks through options gets a plain answer',
		);
		expect(prompt).toContain('Write both in the commit convention the repository states');
		expect(prompt).toContain('`browser_open`');
		expect(prompt).toContain('`browser_screenshot` from the `malini` MCP server');
		expect(prompt).toContain('a routine that runs it with `routines_save`');
		expect(prompt).toContain('A routine starts as a draft the user promotes');
		expect(prompt).toContain('.malini/agent-attachments');
		expect(prompt).toContain('git commit');
		expect(prompt).toContain('the user approved that exact call in Malini');
		expect(prompt).toContain('Never ask the user to test, try or review your work');
		expect(prompt).toContain('one-line bullet that starts with `Next:`');
		expect(prompt).toContain(
			'`![Before: what it shows](path)` and `![After: what it shows](path)`',
		);
		expect(prompt).toContain('`#t=<seconds>` to the After path');
		expect(prompt).toContain('`![Variant A: Name - one-line note](path)`');
		expect(prompt).toContain('`Go with variant B (Name).`');
		expect(prompt).toContain('Other chats and jobs in this workstream can run at the same time');
		expect(prompt).toContain('never revert them, and do not report them as a blocker');
	});

	it('asks for screenshots in the theme the user is in, and names none when Malini sent none', () => {
		expect(systemPromptAppend('/nonexistent/worktree', 'medium', 'dark')).toContain(
			'the user is in dark mode, so capture every screenshot in dark mode',
		);
		expect(systemPromptAppend('/nonexistent/worktree', 'medium')).not.toContain('- Theme:');
	});
});
