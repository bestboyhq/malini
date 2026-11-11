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
			'only answers a question or talks through options, with nothing to show, gets a plain answer',
		);
		expect(prompt).toContain(
			'build the prototype in that same turn, even when the user only asked a question',
		);
		expect(prompt).toContain('Never end a turn offering to prototype');
		expect(prompt).toContain("fill it with the user's real content, never lorem ipsum");
		expect(prompt).toContain('only when you changed files outside `.context/`');
		expect(prompt).toContain('Write both in the commit convention the repository states');
		expect(prompt).toContain('`browser_open`');
		expect(prompt).toContain('`browser_screenshot` from the `malini` MCP server');
		expect(prompt).toContain('close its tab with `browser_close`');
		expect(prompt).toContain('Keep it open only while the user should look at or use that page');
		expect(prompt).toContain('give it a `when` trigger written from `events_list`');
		expect(prompt).toContain(
			'run Open draft or Merge, whichever they asked for, with `automations_run` and its id in `workstream`',
		);
		expect(prompt).toContain(
			"Malini holds the automation until that workstream's chat ends its turn",
		);
		expect(prompt).toContain(
			'every turn a workstream you started ends reaches this chat as a report from that workstream',
		);
		expect(prompt).toContain(
			'reports that arrive while you work come as one prompt after your turn',
		);
		expect(prompt).toContain('Answer what you can settle with `workstreams_send`');
		expect(prompt).toContain('run them as parallel subagents with the Agent tool');
		expect(prompt).toContain('A trigger you add starts Off until the user turns it on');
		expect(prompt).toContain('every shell code block you write has a Run button');
		expect(prompt).not.toContain('routine');
		expect(prompt).toContain('.malini/agent-attachments');
		expect(prompt).toContain('git commit');
		expect(prompt).toContain('means Malini lets you try that exact call again');
		expect(prompt).toContain('Never ask the user to test, try or review your work');
		expect(prompt).toContain('open it for them with `files_open`');
		expect(prompt).not.toContain('`keys`');
		expect(prompt).toContain('is set in each command you run as `$NAME`');
		expect(prompt).toContain('masks its value as `[secret]` in every output');
		expect(prompt).toContain('ask for it with `secrets_request`');
		expect(prompt).toContain('Never ask the user to paste a secret into the chat');
		expect(prompt).toContain('one-line bullet that starts with `Next:`');
		expect(prompt).toContain(
			'`![Before: what it shows](path)` and `![After: what it shows](path)`',
		);
		expect(prompt).toContain('`#t=<seconds>` to the After path');
		expect(prompt).toContain('`![Variant A: Name - one-line note](path)`');
		expect(prompt).toContain('`Go with variant B (Name).`');
		expect(prompt).toContain('Embed an HTML variant as its page, never a screenshot of it');
		expect(prompt).toContain('never build a switcher into the page');
		expect(prompt).toContain('every picture you embed as a tab of one frame in the report');
		expect(prompt).toContain('never label a lone option a variant');
		expect(prompt).toContain('every other prototype only under `.context/`');
		expect(prompt).toContain('A prototype never enters tracked source');
		expect(prompt).not.toContain('delete the prototype');
		expect(prompt).toContain('never delete, move or overwrite one');
		expect(prompt).toContain('in a `mktemp -d` folder outside the worktree');
		expect(prompt).toContain(
			'Other chats and automations in this workstream can run at the same time',
		);
		expect(prompt).toContain('never revert them, and do not report them as a blocker');
	});

	it('asks for screenshots in the theme the user is in, and names none when Malini sent none', () => {
		expect(systemPromptAppend('/nonexistent/worktree', 'medium', 'dark')).toContain(
			'the user is in dark mode, so capture every screenshot in dark mode',
		);
		expect(systemPromptAppend('/nonexistent/worktree', 'medium')).not.toContain('- Theme:');
	});

	it('asks for Simplified Technical English only when the user turned it on, and for short replies below the high resolution', () => {
		const ste = (report: AgentReport) =>
			systemPromptAppend('/nonexistent/worktree', report, 'dark', undefined, true);

		expect(ste('medium')).toContain('Write every reply in ASD-STE100');
		expect(ste('medium')).toContain('135 words or fewer');
		expect(ste('high')).toContain('Write every reply in ASD-STE100');
		expect(ste('high')).not.toContain('135 words or fewer');
		expect(systemPromptAppend('/nonexistent/worktree', 'medium', 'dark')).not.toContain(
			'ASD-STE100',
		);
	});

	it('hands a started workstream its starter and siblings', () => {
		const child = systemPromptAppend('/nonexistent/worktree', 'medium', undefined, {
			startedBy: { name: 'Unify footers' },
			siblings: [{ repository: 'acme/web', branch: 'malini/w2', path: '/workstreams/w2' }],
		});
		expect(child).toContain(
			[
				'The chat “Unify footers” started this workstream.',
				'It also started these workstreams.',
			].join('\n'),
		);
		expect(child).toContain('never edit them:\n- acme/web on malini/w2: /workstreams/w2');
		expect(child).not.toContain('lead chat');
		expect(child).not.toContain('plan lives');
	});

	it('names the starter and no siblings when it started only this workstream', () => {
		const alone = systemPromptAppend('/nonexistent/worktree', 'medium', undefined, {
			startedBy: { name: 'Fix the footer' },
			siblings: [],
		});
		expect(alone).toContain(
			'The chat “Fix the footer” started this workstream.\n</malini_lineage>',
		);
		expect(systemPromptAppend('/nonexistent/worktree', 'medium')).not.toContain('<malini_lineage>');
	});
});
