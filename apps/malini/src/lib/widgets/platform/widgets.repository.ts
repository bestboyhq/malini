import {
	WIDGET_SIZE_SPANS,
	isWidgetSpan,
	parseWidgetData,
	type WidgetData,
	type WidgetSpan,
} from '$contract/widgets';
import type { MaliniDatabase } from '$main/db/driver';
import { all, column, get, nowIso8601, parseJsonColumn, run } from '$main/db/rows';

export type StoredPlacement = Readonly<{
	widgetId: string;
	span: WidgetSpan;
	approvedFingerprint: string | null;
}>;

export type Placing = Readonly<{
	widgetId: string;
	before: string | null;
	span: WidgetSpan;
	approvedFingerprint: string;
}>;

export type StoredReading = Readonly<{
	fingerprint: string;
	data: WidgetData | null;
	readAt: string | null;
	error: string | null;
	attemptedAt: string | null;
}>;

type PlacementRow = {
	widget_id: string;
	span_columns: number;
	span_rows: number;
	approved_fingerprint: string | null;
};

type ReadingRow = {
	fingerprint: string;
	data: string | null;
	read_at: string | null;
	error: string | null;
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
		`SELECT widget_id, span_columns, span_rows, approved_fingerprint FROM widget_placements
		 WHERE board = ? ORDER BY position, placed_at`,
		board,
	).map((row) => ({
		widgetId: row.widget_id,
		span: storedSpan(row),
		approvedFingerprint: row.approved_fingerprint,
	}));
}

export function placeWidget(db: MaliniDatabase, board: string, placing: Placing): void {
	const { widgetId, before, span, approvedFingerprint } = placing;
	db.transaction(() => {
		const order = listPlacements(db, board)
			.map((placement) => placement.widgetId)
			.filter((id) => id !== widgetId);
		const at = before === null ? -1 : order.indexOf(before);
		order.splice(at === -1 ? order.length : at, 0, widgetId);
		run(
			db,
			`INSERT INTO widget_placements
			   (board, widget_id, position, span_columns, span_rows, approved_fingerprint, placed_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(board, widget_id) DO UPDATE SET
			   span_columns = excluded.span_columns,
			   span_rows = excluded.span_rows,
			   approved_fingerprint = excluded.approved_fingerprint`,
			board,
			widgetId,
			order.length,
			span.columns,
			span.rows,
			approvedFingerprint,
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
		run(db, 'DELETE FROM widget_hidden WHERE board = ? AND widget_id = ?', board, widgetId);
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
	return isWidgetSpan(span) ? span : WIDGET_SIZE_SPANS.small;
}

export function removePlacement(db: MaliniDatabase, board: string, widgetId: string): void {
	run(db, 'DELETE FROM widget_placements WHERE board = ? AND widget_id = ?', board, widgetId);
}

export function hideWidget(db: MaliniDatabase, board: string, widgetId: string): void {
	db.transaction(() => {
		removePlacement(db, board, widgetId);
		run(
			db,
			'INSERT OR IGNORE INTO widget_hidden (board, widget_id, hidden_at) VALUES (?, ?, ?)',
			board,
			widgetId,
			nowIso8601(),
		);
	});
}

export function listHidden(db: MaliniDatabase, board: string): string[] {
	return column(
		db,
		'SELECT widget_id FROM widget_hidden WHERE board = ? ORDER BY hidden_at, widget_id',
		board,
	);
}

export function getReading(
	db: MaliniDatabase,
	board: string,
	widgetId: string,
): StoredReading | null {
	const row = get<ReadingRow>(
		db,
		`SELECT fingerprint, data, read_at, error, attempted_at FROM widget_readings
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
	error: string,
): void {
	run(
		db,
		`INSERT INTO widget_readings (board, widget_id, fingerprint, data, read_at, error, attempted_at)
		 VALUES (?, ?, ?, NULL, NULL, ?, ?)
		 ON CONFLICT(board, widget_id) DO UPDATE SET
		   error = excluded.error,
		   attempted_at = excluded.attempted_at`,
		board,
		widgetId,
		fingerprint,
		error,
		nowIso8601(),
	);
}

function storedData(text: string | null): WidgetData | null {
	try {
		return parseWidgetData(parseJsonColumn(text));
	} catch {
		return null;
	}
}
