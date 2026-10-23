import { describe, expect, it } from 'vitest';
import { jobOutputIssues } from './job-output-checks';

describe('jobOutputIssues', () => {
	it('holds a chat name to the Name chats rules', () => {
		expect(jobOutputIssues('name-chats', 'Jobs page scrolling')).toEqual([]);
		expect(jobOutputIssues('name-chats', 'Landing page entry choice')).toEqual(['4 words']);
		expect(jobOutputIssues('name-chats', 'Investigating failed bestboy deployment')).toEqual([
			'4 words',
			'Starts with a verb',
		]);
		expect(jobOutputIssues('name-chats', 'Deploy failure')).toEqual([]);
		expect(jobOutputIssues('name-chats', 'Fix the flaky test.')).toEqual([
			'4 words',
			'Starts with a verb',
			'Ends with punctuation',
		]);
		expect(jobOutputIssues('name-chats', null)).toEqual(['No name']);
		expect(jobOutputIssues('name-chats', '  ')).toEqual(['No name']);
	});

	it('holds a service name to the Name services rules', () => {
		expect(jobOutputIssues('name-services', 'render lab')).toEqual([]);
		expect(jobOutputIssues('name-services', 'task: run unit tests')).toEqual([]);
		expect(jobOutputIssues('name-services', 'task: run the unit tests now')).toEqual(['5 words']);
		expect(jobOutputIssues('name-services', 'vite')).toEqual(['Names the tool']);
		expect(jobOutputIssues('name-services', 'Start Storybook server')).toEqual([
			'3 words',
			'Not lowercase',
			'Starts with a verb',
		]);
	});
});
