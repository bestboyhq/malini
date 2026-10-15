import { describe, expect, it } from 'vitest';
import { formatAgentTime, formatCpu, formatMemory } from './stats-format';

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
});
