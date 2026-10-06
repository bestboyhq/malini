import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
	DiagnosticEntry,
	DiagnosticLevel,
	DiagnosticProcess,
} from '../../contract/diagnostics';

export const DIAGNOSTICS_DIRECTORY = 'diagnostics';
export const MAX_LOG_BYTES = 256 * 1024;
export const MAX_ROTATED_FILES = 3;
export const MAIN_LOG_STEM = 'main';
export const RENDERER_LOG_STEM = 'renderer-errors';

const LOGS: ReadonlyArray<Readonly<{ stem: string; origin: DiagnosticProcess }>> = [
	{ stem: MAIN_LOG_STEM, origin: 'main' },
	{ stem: RENDERER_LOG_STEM, origin: 'renderer' },
];

const LEVEL_RANK: Readonly<Record<DiagnosticLevel, number>> = { error: 3, warn: 2, info: 1 };

export interface DiagnosticsQuery {
	readonly since?: Date | null;
	readonly minimumLevel?: DiagnosticLevel;
	readonly withToasts?: boolean;
	readonly limit?: number;
}

export function diagnosticsDirectory(appDataRoot: string): string {
	return join(appDataRoot, DIAGNOSTICS_DIRECTORY);
}

export function currentLogPath(directory: string, stem: string): string {
	return join(directory, `${stem}.ndjson`);
}

export function rotatedLogPath(directory: string, stem: string, index: number): string {
	return join(directory, `${stem}.${index}.ndjson`);
}

export function diagnosticsLogFiles(appDataRoot: string): string[] {
	const directory = diagnosticsDirectory(appDataRoot);
	return LOGS.flatMap(({ stem }) => logFilesOldestFirst(directory, stem));
}

export function readDiagnostics(
	appDataRoot: string,
	query: DiagnosticsQuery = {},
): DiagnosticEntry[] {
	const directory = diagnosticsDirectory(appDataRoot);
	const since = query.since?.getTime() ?? Number.NEGATIVE_INFINITY;
	const minimumRank = LEVEL_RANK[query.minimumLevel ?? 'info'];
	const entries = LOGS.flatMap(({ stem, origin }) =>
		logFilesOldestFirst(directory, stem).flatMap((path) => entriesIn(path, origin)),
	)
		.filter((entry) => Date.parse(entry.occurredAt) >= since)
		.filter(
			(entry) =>
				LEVEL_RANK[entry.level] >= minimumRank ||
				(query.withToasts === true && entry.source === 'toast'),
		)
		.map((entry, order) => ({ entry, order, at: Date.parse(entry.occurredAt) }))
		.sort((left, right) => left.at - right.at || left.order - right.order)
		.map(({ entry }) => entry);
	return query.limit === undefined ? entries : entries.slice(-Math.max(0, query.limit));
}

export function diagnosticEntryFrom(
	line: string,
	origin: DiagnosticProcess,
): DiagnosticEntry | null {
	let record: unknown;
	try {
		record = JSON.parse(line);
	} catch {
		return null;
	}
	if (!isRecord(record)) return null;
	const occurredAt = text(record['occurredAt']);
	if (occurredAt === null || Number.isNaN(Date.parse(occurredAt))) return null;
	const error = isRecord(record['error']) ? record['error'] : {};
	const route = text(record['route']);
	return {
		occurredAt,
		process: origin,
		level: levelOf(record['level']),
		source: text(record['source']) ?? 'unknown',
		message: text(record['message']) ?? text(error['message']) ?? '',
		detail: text(error['detail']),
		errorName: text(error['name']),
		code: text(error['code']) ?? text(error['kind']),
		command: text(record['command']),
		durationMs: typeof record['durationMs'] === 'number' ? record['durationMs'] : null,
		suppressedRepeats:
			typeof record['suppressedRepeats'] === 'number' ? record['suppressedRepeats'] : 0,
		workstreamId: text(record['workstreamId']),
		viewing: workstreamIdInRoute(route),
		route,
	};
}

function logFilesOldestFirst(directory: string, stem: string): string[] {
	const rotated = Array.from({ length: MAX_ROTATED_FILES }, (_, index) =>
		rotatedLogPath(directory, stem, MAX_ROTATED_FILES - index),
	);
	return [...rotated, currentLogPath(directory, stem)];
}

function entriesIn(path: string, origin: DiagnosticProcess): DiagnosticEntry[] {
	let contents: string;
	try {
		contents = readFileSync(path, 'utf8');
	} catch {
		return [];
	}
	return contents
		.split('\n')
		.filter((line) => line.trim().length > 0)
		.flatMap((line) => diagnosticEntryFrom(line, origin) ?? []);
}

function levelOf(value: unknown): DiagnosticLevel {
	if (value === 'warn' || value === 'info' || value === 'error') return value;
	return 'error';
}

function workstreamIdInRoute(route: string | null): string | null {
	const segment = /^\/workstreams\/([^/?#]+)/u.exec(route ?? '')?.[1];
	if (!segment) return null;
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}
