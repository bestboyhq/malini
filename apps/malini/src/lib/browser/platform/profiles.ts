import { DEFAULT_BROWSER_PROFILE } from '$contract/browser';
import type { MaliniDatabase } from '$main/db/driver';
import { all, run } from '$main/db/rows';

export function rememberBrowserProfile(db: MaliniDatabase, name: string, now = new Date()): void {
	if (name === DEFAULT_BROWSER_PROFILE) return;
	run(
		db,
		'INSERT INTO browser_profiles (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING',
		name,
		now.toISOString(),
	);
}

export function listBrowserProfiles(db: MaliniDatabase): string[] {
	return all<{ name: string }>(db, 'SELECT name FROM browser_profiles ORDER BY name').map(
		({ name }) => name,
	);
}
