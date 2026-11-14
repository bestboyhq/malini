import { execFileSync } from 'node:child_process';
import { chmodSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

const WINDOWS = process.platform === 'win32';
const EVERYONE = '*S-1-1-0';

export const DENIED = WINDOWS
	? { code: 'EPERM', reason: 'operation not permitted' }
	: { code: 'EACCES', reason: 'permission denied' };

export function removeAll(dirs: string[]): void {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
}

function icacls(path: string, ...change: string[]): void {
	execFileSync('icacls', [path, ...change], { stdio: 'ignore' });
}

export function lockFolder(folder: string): void {
	if (!WINDOWS) return chmodSync(folder, 0o555);
	icacls(folder, '/deny', `${EVERYONE}:(WD,AD,DC)`);
	icacls(folder, '/deny', `${EVERYONE}:(OI)(CI)(NP)(DE)`);
	icacls(dirname(folder), '/deny', `${EVERYONE}:(DC)`);
}

export function lockTree(root: string): void {
	if (!WINDOWS) return void execFileSync('chmod', ['-R', 'a-w', root]);
	icacls(root, '/deny', `${EVERYONE}:(OI)(CI)(WD,AD)`);
}

export function unlock(path: string): void {
	if (!WINDOWS) return void execFileSync('chmod', ['-R', 'u+w', path]);
	icacls(path, '/remove:d', EVERYONE);
	icacls(dirname(path), '/remove:d', EVERYONE);
}
