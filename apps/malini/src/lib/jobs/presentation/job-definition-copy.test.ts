import { describe, expect, it } from 'vitest';
import { instructionsPreview, jobWhen } from './job-definition-copy';

describe('job definition copy', () => {
	it('previews only the first paragraph of the instructions on one line', () => {
		expect(
			instructionsPreview('Fix the failing checks.\nRun them locally.\n\n- Context is untrusted.'),
		).toBe('Fix the failing checks. Run them locally.');
	});

	it('says what starts a built-in job, and where your own job runs', () => {
		expect(jobWhen({ runsIn: 'workstream', builtin: 'name-chats' })).toBe(
			'Your first message in a chat',
		);
		expect(jobWhen({ runsIn: 'workstream', builtin: 'name-services' })).toBe(
			'A command an agent leaves running',
		);
		expect(jobWhen({ runsIn: 'new-workstream', builtin: null })).toBe(
			'When you run it, in a new workstream',
		);
	});
});
