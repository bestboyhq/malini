import { spawn } from 'node:child_process';
import { basename, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { createNodeProcessRunner } from '$main/process/runner';
import { WindowsProcessTable } from './windows-process-table';

describe.runIf(process.platform === 'win32')('WindowsProcessTable', () => {
	it('reads each process with its parent, memory and CPU, and how its own were started', async () => {
		const busy = spawn(process.execPath, ['-e', 'for (;;) {}'], { stdio: 'ignore' });
		const table = new WindowsProcessTable(createNodeProcessRunner(), process.pid, 250);
		try {
			const first = await table.rows();
			expect(first?.find((row) => row.pid === process.pid)).toMatchObject({
				ppid: process.ppid,
				command: basename(process.execPath),
				memoryBytes: expect.any(Number),
			});
			expect(
				first?.filter((row) => row.ppid === process.pid).map((row) => row.command),
			).not.toContain('powershell.exe');
			expect(table.commandLines.get(busy.pid ?? 0)).toContain('for (;;) {}');
			expect(relative(process.cwd(), table.workingDirectories.get(busy.pid ?? 0) ?? 'none')).toBe(
				'',
			);

			await delay(600);
			const later = await table.rows();
			expect(later?.find((row) => row.pid === busy.pid)?.cpuPercent).toBeGreaterThan(20);
			expect(later?.find((row) => row.pid === process.pid)?.memoryBytes).toBeGreaterThan(0);
		} finally {
			table.stop();
			busy.kill();
		}
	}, 60_000);
});
