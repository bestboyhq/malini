import { describe, expect, it } from 'vitest';
import { failureLine, issueNumber, journeyLine, problemBody, problemTitle } from './problem-report';

describe('a problem report', () => {
	it('titles the issue with the first line you wrote, cut to fit', () => {
		expect(problemTitle('\n  Nothing   ran\nwhen I pressed Enter')).toBe('Nothing ran');
		const long = problemTitle('x'.repeat(200));
		expect(long).toHaveLength(80);
		expect(long.endsWith('…')).toBe(true);
	});

	it('sends your words, then only the facts you kept', () => {
		expect(problemBody(' It broke. ', [])).toBe('It broke.');
		expect(problemBody('It broke.', ['Malini 1.0.0', 'Setup done'])).toBe(
			'It broke.\n\n---\n\n- Malini 1.0.0\n- Setup done',
		);
	});

	it('says how far you got', () => {
		expect(journeyLine({ repositories: 1, prompts: 0, merges: 2 })).toBe(
			'1 repository · 0 prompts · 2 merges',
		);
		expect(journeyLine({ repositories: 0, prompts: 1, merges: 1 })).toBe(
			'0 repositories · 1 prompt · 1 merge',
		);
	});

	it('names a failure without its message', () => {
		expect(failureLine('chat.send-prompt', 'LifecycleError', null)).toBe(
			'chat.send-prompt failed: LifecycleError',
		);
		expect(failureLine('chat.send-prompt', 'LifecycleError', 'already_running')).toBe(
			'chat.send-prompt failed: LifecycleError (already_running)',
		);
		expect(failureLine('repositories.clone', null, null)).toBe('repositories.clone failed');
	});

	it('reads the issue number from the link gh prints', () => {
		expect(issueNumber('https://github.com/bestboyhq/malini/issues/214\n')).toBe(214);
		expect(issueNumber('Creating issue in bestboyhq/malini')).toBeNull();
	});
});
