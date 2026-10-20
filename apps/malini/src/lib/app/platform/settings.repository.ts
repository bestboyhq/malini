import type { MaliniDatabase } from '$main/db/driver';
import { all, get, run } from '$main/db/rows';

export function getSetting(db: MaliniDatabase, key: string): string | null {
	const row = get<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', key);
	return row ? row.value : null;
}

export function setSetting(db: MaliniDatabase, key: string, value: string): void {
	run(
		db,
		`INSERT INTO settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
		key,
		value,
	);
}

export function listSettings(db: MaliniDatabase): Record<string, string> {
	const settings: Record<string, string> = {};
	for (const row of all<{ key: string; value: string }>(
		db,
		'SELECT key, value FROM settings ORDER BY key',
	)) {
		settings[row.key] = row.value;
	}
	return settings;
}
