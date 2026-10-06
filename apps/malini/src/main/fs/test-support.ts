import { rmSync } from 'node:fs';

export function removeAll(dirs: string[]): void {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}
