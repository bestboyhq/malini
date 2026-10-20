import { describe, expect, it } from 'vitest';
import {
	completeVisualLineChunks,
	MIN_REVEAL_INTERVAL_MS,
	nextCompleteVisualLineChunk,
	REVEAL_INTERVAL_MS,
	revealIntervalMs,
} from './streaming-playback';

const monospaceWidth = (text: string): number => text.length;

describe('completeVisualLineChunks', () => {
	it('withholds the incomplete final visual line', () => {
		expect(completeVisualLineChunks('one two three four', 10, monospaceWidth)).toEqual([
			'one two ',
		]);
	});

	it('releases short lines when the provider sends an explicit newline', () => {
		expect(completeVisualLineChunks('Thinking\nReading files', 80, monospaceWidth)).toEqual([
			'Thinking\n',
		]);
	});

	it('queues several complete lines independently from provider chunk boundaries', () => {
		expect(
			completeVisualLineChunks('one two three four five six seven', 10, monospaceWidth),
		).toEqual(['one two ', 'three four ', 'five six ']);
	});

	it('releases the final partial line only when the message is complete', () => {
		expect(completeVisualLineChunks('one two', 80, monospaceWidth)).toEqual([]);
		expect(completeVisualLineChunks('one two', 80, monospaceWidth, true)).toEqual(['one two']);
	});
});

describe('nextCompleteVisualLineChunk', () => {
	it('continues from a source offset without scanning the already revealed prefix', () => {
		const measured: string[] = [];
		const source = `${'already revealed '.repeat(5_000)}next line\ntrailing partial`;
		const offset = source.indexOf('next line');

		expect(
			nextCompleteVisualLineChunk(source, offset, 80, (text) => {
				measured.push(text);
				return text.length;
			}),
		).toBe('next line\n');
		expect(measured.join('')).toBe('next line');
	});

	it('stops after the first complete visual line even when a very large backlog follows', () => {
		let measuredCharacters = 0;
		const source = `first line\n${'unprocessed backlog '.repeat(20_000)}`;

		expect(
			nextCompleteVisualLineChunk(source, 0, 80, (text) => {
				measuredCharacters += text.length;
				return text.length;
			}),
		).toBe('first line\n');
		expect(measuredCharacters).toBe('first line'.length);
	});

	it('withholds an incomplete line until a newline or wrap makes it stable', () => {
		expect(nextCompleteVisualLineChunk('still growing', 0, 80, monospaceWidth)).toBeNull();
		expect(nextCompleteVisualLineChunk('one two three', 0, 8, monospaceWidth)).toBe('one two ');
	});
});

describe('revealIntervalMs', () => {
	it('reveals at a calm, steady pace while the playback keeps up with the model', () => {
		expect(revealIntervalMs('one line', 0, 80)).toBe(REVEAL_INTERVAL_MS);
		expect(revealIntervalMs('first\nsecond\n', 0, 80)).toBe(REVEAL_INTERVAL_MS);
	});

	it('speeds up as the unrevealed backlog grows, counting short lines and wrapped ones', () => {
		const shortLines = 'rain\n'.repeat(4);
		const wrapped = 'word '.repeat(64);
		expect(revealIntervalMs(shortLines, 0, 80)).toBe(REVEAL_INTERVAL_MS / 2);
		expect(revealIntervalMs(wrapped, 0, 80)).toBe(REVEAL_INTERVAL_MS / 2);
		expect(revealIntervalMs(shortLines, shortLines.length, 80)).toBe(REVEAL_INTERVAL_MS);
	});

	it('never reveals faster than the eye can follow, however long the backlog', () => {
		expect(revealIntervalMs('rain\n'.repeat(10_000), 0, 80)).toBe(MIN_REVEAL_INTERVAL_MS);
	});
});
