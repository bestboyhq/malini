import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configChanged, mcpConfigSnapshot, restamped } from './config-snapshot.js';
import { claudeStateFile } from './user-settings.js';

let folder: string;

beforeEach(() => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'malini-config-')));
	vi.stubEnv('CLAUDE_CONFIG_DIR', join(root, 'claude'));
	mkdirSync(join(root, 'claude'));
	folder = join(root, 'work');
	mkdirSync(folder);
	writeState({ numStartups: 1, mcpServers: { linear: { type: 'http' } } });
});

function writeState(state: Record<string, unknown>): void {
	writeFileSync(claudeStateFile(), JSON.stringify(state));
}

describe('mcpConfigSnapshot', () => {
	it('ignores what Claude Code rewrites in its state file all the time', () => {
		const config = mcpConfigSnapshot(folder);

		writeState({
			numStartups: 2,
			mcpServers: { linear: { type: 'http' } },
			projects: { [folder]: { lastCost: 1, mcpServers: {}, enabledMcpjsonServers: [] } },
		});

		expect(configChanged(config)).toBe(false);
	});

	it('sees a server added for every folder or turned off in this one', () => {
		const config = mcpConfigSnapshot(folder);

		writeState({ mcpServers: { linear: { type: 'http' }, sentry: { type: 'http' } } });
		expect(configChanged(config)).toBe(true);

		writeState({
			mcpServers: { linear: { type: 'http' } },
			projects: { [folder]: { disabledMcpServers: ['linear'] } },
		});
		expect(configChanged(config)).toBe(true);
		expect(configChanged(restamped(config, claudeStateFile()))).toBe(false);
	});
});
