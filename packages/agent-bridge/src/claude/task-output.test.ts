import { describe, expect, it } from 'vitest';
import { lastLine } from './task-output.js';

describe('lastLine', () => {
	it('shows the last line a command printed, without colors or a progress bar redraw', () => {
		expect(lastLine('building\n\u001b[32m✓ 12 passed\u001b[0m\n\n')).toBe('✓ 12 passed');
		expect(lastLine('progress 10%\rprogress 90%')).toBe('progress 90%');
		expect(lastLine('')).toBe('');
	});

	it('cuts a very long line short', () => {
		expect(lastLine('x'.repeat(500))).toHaveLength(200);
	});
});
