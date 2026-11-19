import { readFileSync } from 'node:fs';
import { SourceMap, type SourceMapPayload } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAME_LOCATION = /^\s*at .*?\(?((?:file:\/\/)?\/[^\s()]+):(\d+):(\d+)\)?$/u;
const APP_SOURCE = /\/(?:src\/((?:lib|main|contract)\/.+)|(packages\/(?!.*\/node_modules\/).+))$/u;
const ERROR_FACTORIES = new Set(['main/errors.ts']);

type Origin = Readonly<{ file: string; line: number }>;

const sourceMaps = new Map<string, SourceMap | null>();

export function throwSite(error: unknown): string | null {
	return throwSites(error, 1)[0] ?? null;
}

export function throwSites(error: unknown, limit: number): string[] {
	if (!(error instanceof Error) || typeof error.stack !== 'string') return [];
	const sites: string[] = [];
	for (const frame of error.stack.split('\n')) {
		if (sites.length === limit) break;
		const origin = frameOrigin(frame);
		const source = origin && appSource(origin.file);
		if (!source || ERROR_FACTORIES.has(source)) continue;
		const site = `${source}:${origin.line}`;
		if (sites.at(-1) !== site) sites.push(site);
	}
	return sites;
}

function frameOrigin(frame: string): Origin | null {
	const match = FRAME_LOCATION.exec(frame);
	if (!match?.[1]) return null;
	const file = match[1].startsWith('file://') ? fileURLToPath(match[1]) : match[1];
	if (file.includes('/node_modules/')) return null;
	const line = Number(match[2]);
	const map = sourceMapOf(file);
	if (map === null) return { file, line };
	const origin = map.findOrigin(line, Number(match[3]));
	return 'fileName' in origin
		? { file: resolve(dirname(file), origin.fileName), line: origin.lineNumber }
		: null;
}

function appSource(file: string): string | null {
	if (file.includes('/node_modules/')) return null;
	const match = APP_SOURCE.exec(file);
	return match?.[1] ?? match?.[2] ?? null;
}

function sourceMapOf(file: string): SourceMap | null {
	if (!file.endsWith('.js')) return null;
	const known = sourceMaps.get(file);
	if (known !== undefined) return known;
	const map = readSourceMap(`${file}.map`);
	sourceMaps.set(file, map);
	return map;
}

function readSourceMap(path: string): SourceMap | null {
	try {
		const payload: unknown = JSON.parse(readFileSync(path, 'utf8'));
		return isSourceMapPayload(payload) ? new SourceMap(payload) : null;
	} catch {
		return null;
	}
}

function isSourceMapPayload(value: unknown): value is SourceMapPayload {
	return (
		typeof value === 'object' &&
		value !== null &&
		'mappings' in value &&
		typeof value.mappings === 'string' &&
		'sources' in value &&
		Array.isArray(value.sources)
	);
}
