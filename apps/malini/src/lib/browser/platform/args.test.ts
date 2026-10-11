import { describe, expect, it } from 'vitest';
import { readBounds, readUrl, readWorkstreamId } from './args';

describe('browser command arguments', () => {
	it('reads a workstream id and refuses anything else', () => {
		expect(readWorkstreamId({ workstreamId: 'ws-1' })).toBe('ws-1');
		for (const args of [
			undefined,
			null,
			{},
			{ workstreamId: '' },
			{ workstreamId: '  ' },
			{ workstreamId: 7 },
		]) {
			expect(() => readWorkstreamId(args)).toThrow('`workstreamId` must be a non-empty string');
		}
	});

	it('reads bounds made of finite numbers with no size below zero', () => {
		expect(readBounds({ bounds: { x: 10.5, y: 0, width: 300, height: 0 } })).toEqual({
			x: 10.5,
			y: 0,
			width: 300,
			height: 0,
		});
		for (const bounds of [
			undefined,
			{ x: 0, y: 0, width: 10 },
			{ x: 0, y: 0, width: -1, height: 10 },
			{ x: Number.NaN, y: 0, width: 10, height: 10 },
			{ x: 0, y: Number.POSITIVE_INFINITY, width: 10, height: 10 },
			{ x: '0', y: 0, width: 10, height: 10 },
		]) {
			expect(() => readBounds({ bounds })).toThrow('invalid args: `bounds`');
		}
	});

	it('reads a URL as the address the browser will load', () => {
		expect(readUrl({ url: 'localhost:5173/pricing' })).toBe('http://localhost:5173/pricing');
		expect(() => readUrl({})).toThrow('`url` must be a string');
		expect(() => readUrl({ url: 'file:///etc/hosts' })).toThrow(
			'Only http and https pages open in the browser.',
		);
	});
});
