import { describe, expect, it } from 'vitest';
import { terminalKeySequence, terminalText } from './terminal-text';

describe('terminalText', () => {
	it('drops colors, titles and line endings a terminal hides', () => {
		expect(terminalText('\u001b[31mred\u001b[0m\r\n\u001b]0;title\u0007plain\r\n')).toBe(
			'red\nplain\n',
		);
	});

	it('keeps what a carriage return wrote last on a line', () => {
		expect(terminalText('10%\r50%\r100%\r\ndone')).toBe('100%\ndone');
		expect(terminalText('Downloading\r')).toBe('Downloading');
	});

	it('applies backspaces the terminal echoed', () => {
		expect(terminalText('pasx\b \bs')).toBe('pass');
	});

	it('removes other control characters', () => {
		expect(terminalText('a\u0007b\u0000c\td')).toBe('abc\td');
	});
});

describe('terminalKeySequence', () => {
	const key = (name: string, ctrlKey = false, metaKey = false) =>
		terminalKeySequence({ key: name, ctrlKey, metaKey });

	it('sends what a terminal sends for named keys', () => {
		expect(key('Enter')).toBe('\r');
		expect(key('Backspace')).toBe('\u007f');
		expect(key('ArrowUp')).toBe('\u001b[A');
	});

	it('turns Control and a letter into its control character', () => {
		expect(key('c', true)).toBe('\u0003');
		expect(key('D', true)).toBe('\u0004');
		expect(key('1', true)).toBeNull();
	});

	it('leaves printable keys and Command shortcuts to the browser', () => {
		expect(key('a')).toBeNull();
		expect(key('c', false, true)).toBeNull();
	});
});
