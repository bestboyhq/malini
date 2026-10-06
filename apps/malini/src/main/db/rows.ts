import type { MaliniDatabase } from './driver';

export type BindValue = string | number | bigint | boolean | null | undefined | Uint8Array;

export type SqlValue = string | number | bigint | null | Uint8Array;

export function bind(values: readonly BindValue[]): SqlValue[] {
	return values.map((value) => {
		if (value === undefined) return null;
		if (typeof value === 'boolean') return value ? 1 : 0;
		return value;
	});
}

export type RunResult = { changes: number; lastInsertRowid: number };

export function run(db: MaliniDatabase, sql: string, ...params: BindValue[]): RunResult {
	const result = db.prepare(sql).run(...bind(params));
	return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRow<Row extends object>(value: unknown): value is Row {
	return typeof value === 'object' && value !== null;
}

export function get<Row extends object>(
	db: MaliniDatabase,
	sql: string,
	...params: BindValue[]
): Row | null {
	const row: unknown = db.prepare(sql).get(...bind(params));
	return isRow<Row>(row) ? row : null;
}

export function all<Row extends object>(
	db: MaliniDatabase,
	sql: string,
	...params: BindValue[]
): Row[] {
	const rows: unknown[] = db.prepare(sql).all(...bind(params));
	return rows.filter((row): row is Row => isRow<Row>(row));
}

export function scalar(db: MaliniDatabase, sql: string, ...params: BindValue[]): number {
	const row = get<Record<string, unknown>>(db, sql, ...params);
	if (!row) return 0;
	const first = Object.values(row)[0];
	return typeof first === 'bigint' ? Number(first) : typeof first === 'number' ? first : 0;
}

export function column(db: MaliniDatabase, sql: string, ...params: BindValue[]): string[] {
	return all<Record<string, unknown>>(db, sql, ...params).map((row) =>
		String(Object.values(row)[0]),
	);
}

export function intToBool(value: unknown): boolean {
	return value === 1 || value === 1n || value === true;
}

export function nowIso8601(): string {
	return new Date().toISOString();
}

export function canonicalJson(value: unknown): string {
	return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (isRecord(value)) {
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort()) {
			sorted[key] = sortKeys(value[key]);
		}
		return sorted;
	}
	return value;
}

export function jsonEqual(left: unknown, right: unknown): boolean {
	return canonicalJson(left) === canonicalJson(right);
}

export function parseJsonColumn(text: string | null): unknown {
	if (text === null) return null;
	const parsed: unknown = JSON.parse(text);
	return parsed;
}
