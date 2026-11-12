import { describe, expect, it } from 'vitest';
import { keyPresses } from './keyboard';

const summary = (chord: string, mac = false) =>
	keyPresses(chord, mac).map(({ type, key, modifiers, text, commands }) =>
		[
			`${type} ${JSON.stringify(key)} ${modifiers}`,
			text === undefined ? '' : ` text ${JSON.stringify(text)}`,
			commands === undefined ? '' : ` runs ${commands.join(',')}`,
		].join(''),
	);

describe('keyPresses', () => {
	it('types a character and presses a named key', () => {
		expect(summary('a')).toEqual(['keyDown "a" 0 text "a"', 'keyUp "a" 0']);
		expect(summary('enter')).toEqual(['keyDown "Enter" 0 text "\\r"', 'keyUp "Enter" 0']);
		expect(summary('Esc')).toEqual(['rawKeyDown "Escape" 0', 'keyUp "Escape" 0']);
		expect(summary('Space')).toEqual(['keyDown " " 0 text " "', 'keyUp " " 0']);
		expect(summary('+')).toEqual(['keyDown "+" 0 text "+"', 'keyUp "+" 0']);
	});

	it('holds modifiers around the key and lets them go in reverse order', () => {
		expect(summary('Shift+a')).toEqual([
			'rawKeyDown "Shift" 8',
			'keyDown "A" 8 text "A"',
			'keyUp "A" 8',
			'keyUp "Shift" 0',
		]);
		expect(summary('Control+Shift++')).toEqual([
			'rawKeyDown "Control" 2',
			'rawKeyDown "Shift" 10',
			'rawKeyDown "+" 10',
			'keyUp "+" 10',
			'keyUp "Shift" 2',
			'keyUp "Control" 0',
		]);
		expect(summary('cmd+k')).toEqual([
			'rawKeyDown "Meta" 4',
			'rawKeyDown "k" 4',
			'keyUp "k" 4',
			'keyUp "Meta" 0',
		]);
	});

	it('names the editing command a Mac keyboard runs, and none elsewhere', () => {
		expect(summary('Backspace', true)).toEqual([
			'rawKeyDown "Backspace" 0 runs deleteBackward',
			'keyUp "Backspace" 0',
		]);
		expect(summary('Meta+a', true)[1]).toBe('rawKeyDown "a" 4 runs selectAll');
		expect(summary('Alt+Shift+ArrowLeft', true)[2]).toBe(
			'rawKeyDown "ArrowLeft" 9 runs moveWordLeftAndModifySelection',
		);
		expect(summary('Meta+a')[1]).toBe('rawKeyDown "a" 4');
		expect(summary('Meta+c', true)[1]).toBe('rawKeyDown "c" 4');
	});

	it('refuses a key it does not know', () => {
		expect(() => keyPresses('Hyper+K', true)).toThrow('`Hyper+K` is not a key Malini knows.');
		expect(() => keyPresses('Shift+', true)).toThrow('is not a key Malini knows');
		expect(() => keyPresses('a+b', true)).toThrow('is not a key Malini knows');
		expect(() => keyPresses('Banana', true)).toThrow('is not a key Malini knows');
	});
});
