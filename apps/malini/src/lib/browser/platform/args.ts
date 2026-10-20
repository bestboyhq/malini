import type { BrowserBounds, BrowserTabArgs } from '$contract/browser';

export function readWorkstreamId(args: unknown): string {
	const value = field(args, 'workstreamId');
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error('invalid args: `workstreamId` must be a non-empty string');
	}
	return value;
}

export function readTab(args: unknown): BrowserTabArgs {
	const tabId = field(args, 'tabId');
	if (typeof tabId !== 'string' || tabId.trim().length === 0) {
		throw new Error('invalid args: `tabId` must be a non-empty string');
	}
	return { workstreamId: readWorkstreamId(args), tabId };
}

export function readBounds(args: unknown): BrowserBounds {
	const bounds = field(args, 'bounds');
	const x = field(bounds, 'x');
	const y = field(bounds, 'y');
	const width = field(bounds, 'width');
	const height = field(bounds, 'height');
	if (
		!isFiniteNumber(x) ||
		!isFiniteNumber(y) ||
		!isFiniteNumber(width) ||
		!isFiniteNumber(height) ||
		width < 0 ||
		height < 0
	) {
		throw new Error(
			'invalid args: `bounds` needs finite `x`, `y`, `width` and `height`, no size below zero',
		);
	}
	return { x, y, width, height };
}

export function readUrl(args: unknown): string {
	const value = field(args, 'url');
	if (typeof value !== 'string') throw new Error('invalid args: `url` must be a string');
	return value;
}

function field(args: unknown, key: string): unknown {
	return typeof args === 'object' && args !== null ? Reflect.get(args, key) : undefined;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}
