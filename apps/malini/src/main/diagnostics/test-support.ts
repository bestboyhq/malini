import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { captureMainProcess, nodeProcessHooks } from './capture';
import { currentLogPath, diagnosticsDirectory } from './diagnostics-files';
import { MainDiagnosticsLog } from './main-diagnostics';

export function diagnosticsRecordedDuring(run: () => void): unknown[] {
	const root = mkdtempSync(join(tmpdir(), 'malini-diagnostics-'));
	const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	const stop = captureMainProcess(
		new MainDiagnosticsLog({
			appDataRoot: root,
			runtime: { productName: 'Malini', bundleIdentifier: 'test', version: '0.0.0', pid: 1 },
		}),
		nodeProcessHooks(new EventEmitter()),
	);
	try {
		run();
	} finally {
		stop();
		quiet.mockRestore();
	}
	const path = currentLogPath(diagnosticsDirectory(root), 'main');
	const lines = existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n') : [];
	rmSync(root, { recursive: true, force: true });
	return lines.map((line): unknown => JSON.parse(line));
}
