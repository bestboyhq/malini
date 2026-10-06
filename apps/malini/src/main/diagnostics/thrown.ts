import { inspect } from 'node:util';

export interface ThrownDetail {
	readonly name: string;
	readonly reason: string;
	readonly code: string | null;
	readonly kind: string | null;
	readonly stack: string | null;
	readonly detail: string | null;
	readonly shape: string;
}

export function thrownDetail(error: unknown): ThrownDetail {
	return {
		name: thrownName(error),
		reason: explanation(error).trim(),
		code: stringProperty(error, 'code'),
		kind: stringProperty(error, 'kind'),
		stack: stackWithCauses(error),
		detail: causeChain(error),
		shape: thrownShape(error),
	};
}

export function stringProperty(value: unknown, key: string): string | null {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return null;
	try {
		const property: unknown = Reflect.get(value, key);
		return typeof property === 'string' && property.length > 0 ? property : null;
	} catch {
		return null;
	}
}

const MAX_CAUSE_DEPTH = 5;

function stackWithCauses(error: unknown): string | null {
	if (!(error instanceof Error)) return null;
	const sections = [error.stack || `${error.name}: ${error.message}`];
	let cause: unknown = error.cause;
	for (
		let depth = 0;
		cause !== undefined && cause !== null && depth < MAX_CAUSE_DEPTH;
		depth += 1
	) {
		sections.push(`caused by: ${causeText(cause)}`);
		cause = cause instanceof Error ? cause.cause : undefined;
	}
	return sections.join('\n');
}

const MAX_CAUSE_LINES = 3;

function causeChain(error: unknown): string | null {
	if (!(error instanceof Error)) return null;
	const lines: string[] = [];
	let cause: unknown = error.cause;
	for (
		let depth = 0;
		cause !== undefined && cause !== null && depth < MAX_CAUSE_DEPTH;
		depth += 1
	) {
		lines.push(`caused by ${causeHeadline(cause)}`);
		cause = cause instanceof Error ? cause.cause : undefined;
	}
	return lines.length === 0 ? null : lines.join('\n');
}

function causeHeadline(cause: unknown): string {
	const reason = explanation(cause).trim() || thrownShape(cause);
	const firstLines = reason
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.slice(0, MAX_CAUSE_LINES)
		.join('\n  ');
	return `${thrownName(cause)}: ${firstLines}`;
}

function causeText(cause: unknown): string {
	if (cause instanceof Error) return cause.stack || `${cause.name}: ${cause.message}`;
	return explanation(cause) || thrownShape(cause);
}

function thrownName(error: unknown): string {
	if (error instanceof Error) return error.name || 'Error';
	if (typeof error === 'string') return 'Error';
	return stringProperty(error, 'name') ?? 'NonErrorThrown';
}

function explanation(error: unknown): string {
	if (typeof error === 'string') return error;
	if (error instanceof AggregateError && !error.message.trim()) {
		return error.errors.map(explanation).filter(Boolean).join('; ');
	}
	if (error instanceof Error) {
		return error.message.trim() ? error.message : explanation(error.cause);
	}
	return stringProperty(error, 'message') ?? serializedObject(error);
}

function serializedObject(error: unknown): string {
	if (typeof error !== 'object' || error === null) return '';
	try {
		const serialized = JSON.stringify(error);
		return serialized === '{}' || serialized === '[]' ? '' : serialized;
	} catch {
		return '';
	}
}

function thrownShape(error: unknown): string {
	if (error instanceof Error) return `an empty ${error.name}`;
	return inspect(error, { depth: 2, breakLength: Infinity });
}
