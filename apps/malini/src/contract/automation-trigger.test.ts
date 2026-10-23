import { describe, expect, it } from 'vitest';
import { parseAutomationTrigger } from './automation-trigger';

describe('parseAutomationTrigger event phrases', () => {
	it('parses a channel with set and equality conditions', () => {
		expect(
			parseAutomationTrigger(
				'on pull-requests:ship-changed where merged is set and repositoryId is 01ABC',
			),
		).toEqual({
			kind: 'event',
			channel: 'pull-requests:ship-changed',
			where: [
				{ path: 'merged', equals: null },
				{ path: 'repositoryId', equals: '01ABC' },
			],
			description:
				'When pull requests reports “ship changed”, where merged is set and repositoryId is 01ABC',
		});
	});

	it('parses a bare channel and dotted paths', () => {
		expect(parseAutomationTrigger('on jobs:run-changed')).toMatchObject({
			kind: 'event',
			channel: 'jobs:run-changed',
			where: [],
		});
		expect(parseAutomationTrigger('on jobs:run-changed where run.status is failed')).toMatchObject({
			where: [{ path: 'run.status', equals: 'failed' }],
		});
	});

	it('names the channels of the same domain for a misspelled channel', () => {
		expect(() => parseAutomationTrigger('on jobs:run-finished')).toThrow(
			'Unknown event channel "jobs:run-finished". jobs has jobs:run-changed, jobs:definition-changed, jobs:suggested, jobs:experiment-changed, jobs:agent-action-changed.',
		);
		expect(() => parseAutomationTrigger('on deploys:done')).toThrow(/with domains chat, /u);
	});

	it('rejects a condition without a value', () => {
		expect(() => parseAutomationTrigger('on jobs:run-changed where run.status')).toThrow(
			/Unsupported event condition "run.status"/u,
		);
	});

	it('keeps the plain-text phrases and mentions the event form in its error', () => {
		expect(parseAutomationTrigger('on demand').kind).toBe('manual');
		expect(parseAutomationTrigger('when a new workstream is created').kind).toBe(
			'workstream-created',
		);
		expect(() => parseAutomationTrigger('when the moon is full')).toThrow(/“on <channel>”/u);
	});
});
