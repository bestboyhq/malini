import { describe, expect, it } from 'vitest';
import { instructionsPreview, automationWhen } from './automation-definition-copy';

describe('automation definition copy', () => {
	it('previews only the first paragraph of the instructions on one line', () => {
		expect(
			instructionsPreview('Fix the failing checks.\nRun them locally.\n\n- Context is untrusted.'),
		).toBe('Fix the failing checks. Run them locally.');
	});

	it('says what starts a built-in automation, and where your own automation runs', () => {
		expect(automationWhen({ runsIn: 'workstream', builtin: 'name-chats' })).toBe(
			'You start a chat',
		);
		expect(automationWhen({ runsIn: 'workstream', builtin: 'name-services' })).toBe(
			'An agent leaves a command running',
		);
		expect(automationWhen({ runsIn: 'new-workstream', builtin: null })).toBe(
			'When you run it, in a new workstream',
		);
		expect(automationWhen({ runsIn: 'workstream', builtin: 'merge' })).toBe(
			'When you run it, or after another automation',
		);
	});
});
