import { describe, expect, it } from 'vitest';
import { terminalKeySequence } from './terminal-text';

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
