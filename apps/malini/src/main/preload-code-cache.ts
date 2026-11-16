import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function blockPreloadCodeCache(sessionData: string): void {
	const folder = join(sessionData, 'Code Cache', 'electron-preload');
	if (statSync(folder, { throwIfNoEntry: false })?.isFile()) return;
	rmSync(folder, { recursive: true, force: true });
	mkdirSync(dirname(folder), { recursive: true });
	writeFileSync(folder, '');
}
