import { describe, expect, it } from 'vitest';
import {
	parseAutomationTrigger,
	scheduleWhen,
	unknownTriggerValueMessage,
} from './automation-trigger';

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
		expect(parseAutomationTrigger('on automations:run-changed')).toMatchObject({
			kind: 'event',
			channel: 'automations:run-changed',
			where: [],
		});
		expect(
			parseAutomationTrigger('on automations:run-changed where run.status is failed'),
		).toMatchObject({
			where: [{ path: 'run.status', equals: 'failed' }],
		});
	});

	it('names the channels of the same domain for a misspelled channel', () => {
		expect(() => parseAutomationTrigger('on automations:run-done')).toThrow(
			'Unknown event channel "automations:run-done". automations has automations:run-changed, automations:run-started, automations:run-finished, automations:definition-changed, automations:suggested, automations:experiment-changed, automations:agent-action-changed, automations:tool-called, automations:decision-changed, automations:time-reached.',
		);
		expect(() => parseAutomationTrigger('on deploys:done')).toThrow(/with domains chat, /u);
	});

	it('rejects a condition without a value', () => {
		expect(() => parseAutomationTrigger('on automations:run-changed where run.status')).toThrow(
			/Unsupported event condition "run.status"/u,
		);
	});

	it('reads a stored trigger with a state its event never reports', () => {
		expect(
			parseAutomationTrigger('on automations:run-finished where run.status is succeded'),
		).toMatchObject({
			kind: 'event',
			channel: 'automations:run-finished',
			where: [{ path: 'run.status', equals: 'succeded' }],
		});
	});

	it('names the states an event reports for a state it never reports', () => {
		const message = (when: string) => unknownTriggerValueMessage(parseAutomationTrigger(when));
		expect(message('on automations:run-finished where run.status is succeded')).toBe(
			'automations:run-finished never reports run.status succeded. It reports succeeded, failed, or cancelled.',
		);
		expect(message('on automations:decision-changed where decision.status is asked')).toMatch(
			/^automations:decision-changed never reports decision\.status asked\./u,
		);
		expect(
			message(
				'on automations:run-finished where run.status is succeeded and run.definitionId is 01X',
			),
		).toBeNull();
		expect(message('on automations:run-finished where run.status is set')).toBeNull();
		expect(message('every day at 07:00')).toBeNull();
	});

	it('keeps the plain-text phrases and mentions the event form in its error', () => {
		expect(parseAutomationTrigger('on demand').kind).toBe('manual');
		expect(parseAutomationTrigger('when a new workstream is created').kind).toBe(
			'workstream-created',
		);
		expect(() => parseAutomationTrigger('when the moon is full')).toThrow(/“on <channel>”/u);
	});
});

describe('parseAutomationTrigger schedules', () => {
	it('reads a day, the weekdays or one day of the week at a time, at Home without a place', () => {
		expect(parseAutomationTrigger('every weekday at 9:05')).toEqual({
			kind: 'schedule',
			cadence: 'weekday',
			hour: 9,
			minute: 5,
			place: { kind: 'home' },
			description: 'Every weekday at 9:05',
		});
		expect(parseAutomationTrigger('Every Monday at 17:30')).toMatchObject({
			cadence: 'monday',
			description: 'Every Monday at 17:30',
		});
	});

	it('reads an organization or a repository as the place it runs in', () => {
		expect(parseAutomationTrigger('every day at 07:00 in bestboyhq')).toMatchObject({
			place: { kind: 'owner', owner: 'bestboyhq' },
		});
		expect(parseAutomationTrigger('every day at 07:00 in bestboyhq/malini')).toMatchObject({
			place: { kind: 'repository', repository: 'bestboyhq/malini' },
		});
	});

	it('writes a schedule back as the phrase it reads', () => {
		for (const when of ['every day at 07:00', 'every friday at 23:59 in acme/app']) {
			const trigger = parseAutomationTrigger(when);
			if (trigger.kind !== 'schedule') throw new Error(`${when} is no schedule`);
			expect(scheduleWhen(trigger)).toBe(when);
		}
	});

	it('rejects a time that does not exist and a day it does not know', () => {
		for (const when of ['every day at 24:00', 'every day at 9:60', 'every morning at 9:00']) {
			expect(() => parseAutomationTrigger(when)).toThrow(/Unsupported schedule/u);
		}
		expect(() => parseAutomationTrigger('every day')).toThrow(/every weekday at 09:00 in/u);
	});
});
