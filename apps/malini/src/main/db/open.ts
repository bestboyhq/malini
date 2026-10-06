import { openDatabase, type MaliniDatabase } from './driver';
import { migrate } from './migrations';

export function openMigratedDatabase(path: string): MaliniDatabase {
	const db = openDatabase(path);
	migrate(db);
	return db;
}
