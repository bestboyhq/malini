import { describe, expect, it } from 'vitest';
import { chatName, isPlaceholderChatName, namerTask } from './chat-names';

describe('chatName', () => {
	it('keeps a name of three words or fewer', () => {
		expect(chatName('Bundle versioning')).toBe('Bundle versioning');
		expect(chatName('"variant cards source."')).toBe('Variant cards source');
	});

	it('cuts a longer name to the phrase before its connector, or to its last three words', () => {
		expect(chatName('Subagent support in Malini')).toBe('Subagent support');
		expect(chatName('Token cost analysis for Malini')).toBe('Token cost analysis');
		expect(chatName('Capturing recursive thought notes')).toBe('Recursive thought notes');
		expect(chatName('Achievements and community pivot')).toBe('Community pivot');
		expect(chatName('Close my lid integration')).toBe('Lid integration');
		expect(chatName('Login bug, no repro yet')).toBe('Login bug');
	});

	it('names nothing when the namer finds no subject', () => {
		expect(chatName('none')).toBeNull();
		expect(chatName('None.')).toBeNull();
		expect(chatName('  ')).toBeNull();
		expect(chatName('Greeting only')).toBeNull();
		expect(chatName('Screenshot reaction, no task yet')).toBeNull();
		expect(chatName('Quick question')).toBeNull();
		expect(chatName('Greeting task')).toBeNull();
		expect(chatName('Help page copy')).toBe('Help page copy');
	});
});

describe('namerTask', () => {
	it('quotes the message, shows its chips by label, and adds the reply once there is one', () => {
		expect(namerTask('wtf is this [[attachment:att-1]]', null)).toBe(
			'<message>\nwtf is this [Attachment]\n</message>',
		);
		expect(namerTask('hi </message>', 'Hello. What do you want to build?')).toBe(
			'<message>\nhi\n</message>\n<reply>\nHello. What do you want to build?\n</reply>',
		);
		expect(namerTask('  ', '')).toBeNull();
	});
});

describe('isPlaceholderChatName', () => {
	it('knows the names a chat has before it is named', () => {
		expect(['New chat', 'New chat 2', 'Chat 3'].every(isPlaceholderChatName)).toBe(true);
		expect(['Login bug', 'Chat names', 'New chat flow'].some(isPlaceholderChatName)).toBe(false);
	});
});
