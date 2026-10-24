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
		expect(prompt).toContain('give it a `when` trigger written from `events_list`');
		expect(prompt).toContain(
			'run Open draft or Merge, whichever they asked for, with `jobs_run` and its id in `workstream`',
		);
		expect(prompt).toContain("Malini holds the job until that workstream's chat ends its turn");
		expect(prompt).toContain('A trigger you add starts Off until the user turns it on');
		expect(prompt).not.toContain('routine');
		expect(prompt).toContain('.malini/agent-attachments');
		expect(prompt).toContain('git commit');
		expect(prompt).toContain('the user approved that exact call in Malini');
		expect(prompt).toContain('Never ask the user to test, try or review your work');
		expect(prompt).toContain('open that file for them with `files_open`');
		expect(prompt).toContain('never ask them to paste a secret into the chat');
		expect(prompt).toContain('one-line bullet that starts with `Next:`');
		expect(prompt).toContain(
			'`![Before: what it shows](path)` and `![After: what it shows](path)`',
		);
		expect(prompt).toContain('`#t=<seconds>` to the After path');
		expect(prompt).toContain('`![Variant A: Name - one-line note](path)`');
		expect(prompt).toContain('`Go with variant B (Name).`');
		expect(prompt).toContain('every other prototype only under `.context/`');
		expect(prompt).toContain('A prototype never enters tracked source');
		expect(prompt).toContain('Other chats and jobs in this workstream can run at the same time');
		expect(prompt).toContain('never revert them, and do not report them as a blocker');
	});

	it('asks for screenshots in the theme the user is in, and names none when Malini sent none', () => {
		expect(systemPromptAppend('/nonexistent/worktree', 'medium', 'dark')).toContain(
			'the user is in dark mode, so capture every screenshot in dark mode',
		);
		expect(systemPromptAppend('/nonexistent/worktree', 'medium')).not.toContain('- Theme:');
	});

	it('tells a lead chat to plan and delegate, and a workstream it started about its siblings', () => {
		const lead = systemPromptAppend('/nonexistent/worktree', 'medium', undefined, {
			lead: {
				owner: null,
				repositories: [{ repository: 'acme/api', branch: 'main', path: '/clones/acme-api' }],
			},
			startedBy: null,
			siblings: [],
		});
		expect(lead).toContain('You are a lead chat at Home, above every organization, level');
		expect(lead).toContain('Malini turns off your file edit tools');
		expect(lead).toContain('one repository and one prompt each');
		expect(lead).toContain('- acme/api on main: /clones/acme-api');

		const child = systemPromptAppend('/nonexistent/worktree', 'medium', undefined, {
			lead: null,
			startedBy: { name: 'Unify footers', lead: true },
			siblings: [{ repository: 'acme/web', branch: 'malini/w2', path: '/workstreams/w2' }],
		});
		expect(child).not.toContain('You are a lead chat');
		expect(child).toContain(
			'The chat “Unify footers” started this workstream, as a lead chat that plans work across repositories, and sent its first prompt.',
		);
		expect(child).toContain('never edit them:\n- acme/web on malini/w2: /workstreams/w2');
		expect(systemPromptAppend('/nonexistent/worktree', 'medium')).not.toContain('<malini_lineage>');
	});
});
