import { describe, expect, it } from 'vitest';
import { automationOutputIssues } from './automation-output-checks';

describe('automationOutputIssues', () => {
	it('holds a chat name to the Name chats rules', () => {
		expect(automationOutputIssues('name-chats', 'Automations page scrolling')).toEqual([]);
		expect(automationOutputIssues('name-chats', 'Landing page entry choice')).toEqual(['4 words']);
		expect(automationOutputIssues('name-chats', 'Investigating failed bestboy deployment')).toEqual(
			['4 words', 'Starts with a verb'],
		);
		expect(automationOutputIssues('name-chats', 'Deploy failure')).toEqual([]);
		expect(automationOutputIssues('name-chats', 'Fix the flaky test.')).toEqual([
			'4 words',
			'Starts with a verb',
			'Ends with punctuation',
		]);
		expect(automationOutputIssues('name-chats', null)).toEqual(['No name']);
		expect(automationOutputIssues('name-chats', '  ')).toEqual(['No name']);
	});

	it('holds a service name to the Name services rules', () => {
		expect(automationOutputIssues('name-services', 'render lab')).toEqual([]);
		expect(automationOutputIssues('name-services', 'task: run unit tests')).toEqual([]);
		expect(automationOutputIssues('name-services', 'task: run the unit tests now')).toEqual([
			'5 words',
		]);
		expect(automationOutputIssues('name-services', 'vite')).toEqual(['Names the tool']);
		expect(automationOutputIssues('name-services', 'Start Storybook server')).toEqual([
			'3 words',
			'Not lowercase',
			'Starts with a verb',
		]);
	});
});
