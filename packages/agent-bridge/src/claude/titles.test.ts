import { describe, expect, it } from 'vitest';
import { cleanTitle } from './titles.js';

describe('cleanTitle', () => {
	it('keeps a short name and trims quotes, markdown and trailing punctuation', () => {
		expect(cleanTitle('Bundle versioning')).toBe('Bundle versioning');
		expect(cleanTitle('"legal pages design."\n')).toBe('Legal pages design');
		expect(cleanTitle('**Dark mode tokens**')).toBe('Dark mode tokens');
	});

	it('rejects a reply that is not a name', () => {
		expect(cleanTitle('')).toBeNull();
		expect(cleanTitle('I need more context to name this task.')).toBeNull();
		expect(cleanTitle('Sidebar flicker\n\nThis names the bug.')).toBeNull();
		expect(cleanTitle('Supercalifragilisticexpialidocious configuration overhaul')).toBeNull();
	});
});
