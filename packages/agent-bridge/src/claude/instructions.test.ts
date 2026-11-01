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
		expect(prompt).toContain('give it a `when` trigger written from `events_list`');
		expect(prompt).toContain(
			'run Open draft or Merge, whichever they asked for, with `jobs_run` and its id in `workstream`',
		);
		expect(prompt).toContain("Malini holds the job until that workstream's chat ends its turn");
		expect(prompt).toContain(
			'every turn a workstream you started ends reaches this chat as a report from that workstream',
		);
		expect(prompt).toContain(
			'reports that arrive while you work come as one prompt after your turn',
		);
		expect(prompt).toContain('Answer what your plan covers with `workstreams_send`');
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
		expect(prompt).toContain('Other chats and jobs in this workstream can run at the same time');
		expect(prompt).toContain('never revert them, and do not report them as a blocker');
	});

	it('asks for screenshots in the theme the user is in, and names none when Malini sent none', () => {
		expect(systemPromptAppend('/nonexistent/worktree', 'medium', 'dark')).toContain(
			'the user is in dark mode, so capture every screenshot in dark mode',
		);
		expect(systemPromptAppend('/nonexistent/worktree', 'medium')).not.toContain('- Theme:');
	});

	it('tells a lead chat to plan, delegate and bring the user decisions, in this order', () => {
		const lead = systemPromptAppend('/nonexistent/worktree', 'medium', undefined, {
			lead: {
				owner: null,
				repositories: [{ repository: 'acme/api', branch: 'main', path: '/clones/acme-api' }],
				workstreams: [{ repository: 'acme/web', branch: 'malini/w1', path: '/workstreams/w1' }],
				plan: '/plans/lead-1/plan.md',
			},
			startedBy: null,
			siblings: [],
		});
		const lineage = lead.slice(lead.indexOf('<malini_lineage>'));

		expect(lineage.split('\n').map((line) => line.split(' ').slice(0, 4).join(' '))).toEqual([
			'<malini_lineage>',
			'You are a lead',
			'- Malini starts each',
			'- Malini turns off',
			'- Your plan lives',
			'- Bring the user',
			'- The user reads',
			'- Read code to',
			'- `workstreams_list` shows what',
			'Repositories you can read:',
			'- acme/api on main:',
			'Workstreams you started; read',
			'- acme/web on malini/w1:',
			'</malini_lineage>',
		]);
		expect(lineage).toContain('You are a lead chat at Home, above every organization, level');
		expect(lineage).toContain(
			"- Malini starts each of your turns in a fresh Claude Code session, from this chat's timeline as the user sees it: their messages, your replies, the reports of the workstreams you started and the decisions. What you only read with tools in an earlier turn is gone, so keep what the work needs in your plan.",
		);
		expect(lineage).toContain('one repository and one prompt each');
		expect(lineage).toContain('hand each change, a prototype included, to a workstream');
		expect(lineage).toContain(
			'- Your plan lives at /plans/lead-1/plan.md. Write it with `plan_write` before you start workstreams, and keep it current: what each workstream builds, the contract between them and the decisions so far. Every workstream you start gets its path, so point to it in prompts instead of pasting it, and tell each one with `workstreams_send` when it changes.',
		);
		expect(lineage).toContain(
			"- Bring the user only what they must decide, with `decisions_ask`: one decision per call, with a picture for each option when there is one to show, such as a variant a workstream's report embeds. Keep the work going while the user decides: have the workstreams build the option you recommend meanwhile. When the user answers in a message, record each answer it covers with `decisions_answer`. End a turn that leaves decisions open with their topics in `Needs:`, so Malini tells the user they wait; what no decision card can ask, such as a secret or access, goes there too.",
		);
		expect(lineage).toContain(
			'- The user reads this chat as a timeline: your tool calls fold into one line, and each of your replies shows only its `Outcome:` line until they open it, so make that line say what changed.',
		);
		expect(lineage).toContain(
			'Repositories you can read:\n- acme/api on main: /clones/acme-api\nWorkstreams you started; read their checkouts and reports, and never edit them:\n- acme/web on malini/w1: /workstreams/w1',
		);
	});

	it('hands a workstream a lead started its plan and siblings, and names no plan when it has none', () => {
		const child = systemPromptAppend('/nonexistent/worktree', 'medium', undefined, {
			lead: null,
			startedBy: { name: 'Unify footers', lead: true, plan: '/plans/lead-1/plan.md' },
			siblings: [{ repository: 'acme/web', branch: 'malini/w2', path: '/workstreams/w2' }],
		});
		expect(child).not.toContain('You are a lead chat');
		expect(child).toContain(
			[
				'The chat “Unify footers” started this workstream, as a lead chat that plans work across repositories, and sent its first prompt.',
				'- Its plan lives at /plans/lead-1/plan.md: read it before you start, build against it, and read it again whenever that chat tells you it changed. Never edit it.',
				'It also started these workstreams.',
			].join('\n'),
		);
		expect(child).toContain('never edit them:\n- acme/web on malini/w2: /workstreams/w2');

		const withoutPlan = systemPromptAppend('/nonexistent/worktree', 'medium', undefined, {
			lead: null,
			startedBy: { name: 'Fix the footer', lead: false, plan: null },
			siblings: [],
		});
		expect(withoutPlan).toContain(
			'The chat “Fix the footer” started this workstream and sent its first prompt.\n</malini_lineage>',
		);
		expect(withoutPlan).not.toContain('Its plan lives at');
		expect(systemPromptAppend('/nonexistent/worktree', 'medium')).not.toContain('<malini_lineage>');
	});
});
