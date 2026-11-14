import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicReplaceFile } from './atomic';
import { removeAll } from './test-support';

const dirs: string[] = [];

afterEach(() => removeAll(dirs));

describe('atomicReplaceFile', () => {
	it.runIf(process.platform === 'win32')(
		'replaces a file another program holds open once it lets go, as Windows refuses until then',
		async () => {
			const dir = mkdtempSync(join(tmpdir(), 'malini-atomic-'));
			dirs.push(dir);
			const target = join(dir, 'held.txt');
			writeFileSync(target, 'before');
			const holder = spawn(
				'powershell.exe',
				[
					'-NoProfile',
					'-Command',
					`$held = [System.IO.File]::Open('${target}', 'Open', 'Read', 'Read'); 'held'; Start-Sleep -Milliseconds 500; $held.Close()`,
				],
				{ stdio: ['ignore', 'pipe', 'inherit'] },
			);
			const exited = once(holder, 'exit');
			await once(holder.stdout, 'data');

			await atomicReplaceFile(target, 'after');

			expect(readFileSync(target, 'utf8')).toBe('after');
			await exited;
		},
	);
});
