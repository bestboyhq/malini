import { describe, expect, it } from 'vitest';
import { mayAskUser, replyFix } from './reply-check.js';

describe('replyFix', () => {
	it('sends a reply back only with what to fix', () => {
		expect(replyFix({ ok: false, fix: ' "isn\'t" is a contraction. ' })).toBe(
			'"isn\'t" is a contraction.',
		);
	});

	it('lets a reply through on a pass, a fail with nothing to fix, or an answer of another shape', () => {
		expect(replyFix({ ok: true })).toBeNull();
		expect(replyFix({ ok: true, fix: 'Shorter.' })).toBeNull();
		expect(replyFix({ ok: false })).toBeNull();
		expect(replyFix({ ok: false, fix: '  ' })).toBeNull();
		expect(replyFix({ ok: 'false', fix: 'Shorter.' })).toBeNull();
		expect(replyFix(null)).toBeNull();
	});
});

describe('mayAskUser', () => {
	it.each([
		'The flag stays. Should I also update the docs?',
		'Two ways work. **Keep the old one?**',
		'The fix is ready. Say go and I build it.',
		'Let me know which one you want.',
		'Done.\n\nOutcome: The copy is new\nNeeds: approve the two new sentences',
		'Done.\n\n**Outcome:** It works\n**Needs:** your go on the merge',
		'Done.\n\n- Next: Decide whether to keep the old flag.\n\nOutcome: It works\nNeeds: nothing',
	])('sends %j to the check', (reply) => {
		expect(mayAskUser(reply)).toBe(true);
	});

	it.each([
		'Done.\n\nOutcome: It works\nNeeds: nothing\nCommit: fix: it\nPull request: fix: it',
		'Done.\n\n**Outcome:** It works\n**Needs:** nothing.',
		'The page at https://example.com/search?q=tag lists every tag.',
		'It reads `value ?? fallback` and returns `a ? b : c`.',
		'```ts\nconst ok = ready ? 1 : 0;\n```\nThe build passes.',
		'![Variant A: Search - finds it](.context/v/index.html?a#a)\n\nNeeds: nothing',
		'- Next: Refuse a folder without git in the repository picker.\n\nNeeds: nothing',
	])('lets %j through without a check', (reply) => {
		expect(mayAskUser(reply)).toBe(false);
	});
});
