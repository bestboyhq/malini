import {
	WIDGET_DEFAULT_SPAN,
	isWidgetSpan,
	parseWidgetData,
	type WidgetData,
	type WidgetNeed,
	type WidgetSpan,
} from '$contract/widgets';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, isRecord, nowIso8601, parseJsonColumn, run } from '$main/db/rows';

export type StoredPlacement = Readonly<{ widgetId: string; span: WidgetSpan }>;

export type Placing = Readonly<{ widgetId: string; before: string | null; span: WidgetSpan }>;

export type StoredReading = Readonly<{
	fingerprint: string;
	data: WidgetData | null;
	readAt: string | null;
	error: string | null;
	need: WidgetNeed | null;
	attemptedAt: string | null;
}>;

type PlacementRow = {
	widget_id: string;
	span_columns: number;
	span_rows: number;
};

type ReadingRow = {
	fingerprint: string;
	data: string | null;
	read_at: string | null;
	error: string | null;
	need: string | null;
	attempted_at: string | null;
};

export function startBoard(db: MaliniDatabase, board: string): boolean {
	return (
		run(
			db,
			'INSERT OR IGNORE INTO widget_boards (board, created_at) VALUES (?, ?)',
			board,
			nowIso8601(),
		).changes > 0
	);
}

export function listPlacements(db: MaliniDatabase, board: string): StoredPlacement[] {
	return all<PlacementRow>(
		db,
		`SELECT widget_id, span_columns, span_rows FROM widget_placements
		 WHERE board = ? ORDER BY position, placed_at`,
		board,
	).map((row) => ({ widgetId: row.widget_id, span: storedSpan(row) }));
}

export function placeWidget(db: MaliniDatabase, board: string, placing: Placing): void {
	const { widgetId, before, span } = placing;
	db.transaction(() => {
		const order = listPlacements(db, board)
			.map((placement) => placement.widgetId)
			.filter((id) => id !== widgetId);
		const at = before === null ? -1 : order.indexOf(before);
		order.splice(at === -1 ? order.length : at, 0, widgetId);
		run(
			db,
			`INSERT INTO widget_placements (board, widget_id, position, span_columns, span_rows, placed_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(board, widget_id) DO UPDATE SET
			   span_columns = excluded.span_columns,
			   span_rows = excluded.span_rows`,
			board,
			widgetId,
			order.length,
			span.columns,
			span.rows,
			nowIso8601(),
		);
		order.forEach((id, position) =>
			run(
				db,
				'UPDATE widget_placements SET position = ? WHERE board = ? AND widget_id = ?',
				position,
				board,
				id,
			),
		);
	});
}

export function resizePlacement(
	db: MaliniDatabase,
	board: string,
	widgetId: string,
	span: WidgetSpan,
): boolean {
	return (
		run(
			db,
			'UPDATE widget_placements SET span_columns = ?, span_rows = ? WHERE board = ? AND widget_id = ?',
			span.columns,
			span.rows,
			board,
			widgetId,
		).changes > 0
	);
}

function storedSpan(row: PlacementRow): WidgetSpan {
	const span = { columns: row.span_columns, rows: row.span_rows };
	return isWidgetSpan(span) ? span : WIDGET_DEFAULT_SPAN;
}

export function removePlacement(db: MaliniDatabase, board: string, widgetId: string): void {
	run(db, 'DELETE FROM widget_placements WHERE board = ? AND widget_id = ?', board, widgetId);
}

export function forgetReading(db: MaliniDatabase, board: string, widgetId: string): void {
	run(db, 'DELETE FROM widget_readings WHERE board = ? AND widget_id = ?', board, widgetId);
}

export function getReading(
	db: MaliniDatabase,
	board: string,
	widgetId: string,
): StoredReading | null {
	const row = get<ReadingRow>(
		db,
		`SELECT fingerprint, data, read_at, error, need, attempted_at FROM widget_readings
		 WHERE board = ? AND widget_id = ?`,
		board,
		widgetId,
	);
	if (!row) return null;
	return {
		fingerprint: row.fingerprint,
		data: storedData(row.data),
		readAt: row.read_at,
		error: row.error,
		need: storedNeed(row.need),
		attemptedAt: row.attempted_at,
	};
}

export function recordRead(
	db: MaliniDatabase,
	board: string,
	widgetId: string,
	fingerprint: string,
	data: WidgetData,
): void {
	const now = nowIso8601();
	run(
		db,
		`INSERT INTO widget_readings (board, widget_id, fingerprint, data, read_at, error, attempted_at)
		 VALUES (?, ?, ?, ?, ?, NULL, ?)
		 ON CONFLICT(board, widget_id) DO UPDATE SET
		   fingerprint = excluded.fingerprint,
		   data = excluded.data,
		   read_at = excluded.read_at,
		   error = NULL,
		   need = NULL,
		   attempted_at = excluded.attempted_at`,
		board,
		widgetId,
		fingerprint,
		JSON.stringify(data),
		now,
		now,
	);
}

export function recordFailedRead(
	db: MaliniDatabase,
	board: string,
	widgetId: string,
	fingerprint: string,
	failure: Readonly<{ error: string; need: WidgetNeed | null }>,
): void {
	run(
		db,
		`INSERT INTO widget_readings
		   (board, widget_id, fingerprint, data, read_at, error, need, attempted_at)
		 VALUES (?, ?, ?, NULL, NULL, ?, ?, ?)
		 ON CONFLICT(board, widget_id) DO UPDATE SET
		   error = excluded.error,
		   need = excluded.need,
		   attempted_at = excluded.attempted_at`,
		board,
		widgetId,
		fingerprint,
		failure.error,
		failure.need === null ? null : JSON.stringify(failure.need),
		nowIso8601(),
	);
}

export function getConnection(db: MaliniDatabase, origin: string): Uint8Array | null {
	return (
		get<{ sealed: Uint8Array }>(
			db,
			'SELECT sealed FROM widget_connections WHERE origin = ?',
			origin,
		)?.sealed ?? null
	);
}

export function saveConnection(db: MaliniDatabase, origin: string, sealed: Uint8Array): void {
	run(
		db,
		`INSERT INTO widget_connections (origin, sealed, connected_at) VALUES (?, ?, ?)
		 ON CONFLICT(origin) DO UPDATE SET sealed = excluded.sealed`,
		origin,
		sealed,
		nowIso8601(),
	);
}

export function deleteConnection(db: MaliniDatabase, origin: string): void {
	run(db, 'DELETE FROM widget_connections WHERE origin = ?', origin);
}

function storedNeed(text: string | null): WidgetNeed | null {
	try {
		const need = parseJsonColumn(text);
		const connect = isRecord(need) ? need['connect'] : null;
		return typeof connect === 'string' ? { connect } : null;
	} catch {
		return null;
	}
}

function storedData(text: string | null): WidgetData | null {
	try {
		return parseWidgetData(parseJsonColumn(text));
	} catch {
		return null;
	}
}
