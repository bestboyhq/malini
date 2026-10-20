import { describe, expect, it } from 'vitest';
import {
	formatAgentTime,
	formatCpu,
	formatElapsed,
	formatMemory,
	formatTimeAgo,
} from './stats-format';

const MEGABYTE = 1_024 ** 2;

describe('stats formatting', () => {
	it('shows memory in MB below a thousand MB and in GB from there on', () => {
		expect(formatMemory(564 * MEGABYTE)).toBe('564 MB');
		expect(formatMemory(1_020 * MEGABYTE)).toBe('1.0 GB');
		expect(formatMemory(1_843 * MEGABYTE)).toBe('1.8 GB');
		expect(formatMemory(12_800 * MEGABYTE)).toBe('13 GB');
	});

	it('keeps a busy machine readable and a quiet one honest', () => {
		expect(formatCpu(0)).toBe('0%');
		expect(formatCpu(0.4)).toBe('<1%');
		expect(formatCpu(12.6)).toBe('13%');
		expect(formatAgentTime(42 * 60)).toBe('42m');
		expect(formatAgentTime(54 * 3_600 + 28 * 60 + 59)).toBe('54h 28m');
		expect(formatAgentTime(123 * 3_600)).toBe('123h');
	});

	it('says how long something has run and how long ago a turn ended', () => {
		expect(formatElapsed(-5)).toBe('0s');
		expect(formatElapsed(42_000)).toBe('42s');
		expect(formatElapsed(25 * 60_000 + 59_000)).toBe('25m');
		expect(formatElapsed((3 * 60 + 2) * 60_000)).toBe('3h 2m');
		expect(formatElapsed((50 * 60 + 5) * 60_000)).toBe('2d 2h');
		expect(formatTimeAgo(30_000)).toBe('just now');
		expect(formatTimeAgo(12 * 60_000)).toBe('12m ago');
		expect(formatTimeAgo(3 * 3_600_000)).toBe('3h ago');
		expect(formatTimeAgo(49 * 3_600_000)).toBe('2d ago');
	});
});
