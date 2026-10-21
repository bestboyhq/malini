import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type ConfigSnapshot = ReadonlyMap<string, string>;

export function configSnapshot(cwd: string, memoryFiles: readonly string[]): ConfigSnapshot {
	return new Map([...memoryFiles, ...configFiles(cwd)].map((path) => [path, fileStamp(path)]));
}

export function configChanged(snapshot: ConfigSnapshot): boolean {
	for (const [path, stamp] of snapshot) if (fileStamp(path) !== stamp) return true;
	return false;
}

// ponytail: user and local MCP servers in ~/.claude.json reach a live Claude Code only when it restarts, since Claude Code rewrites that file all the time; compare its mcpServers keys if that matters
function configFiles(cwd: string): string[] {
	const user = process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude');
	return [
		join(user, 'settings.json'),
		join(user, 'CLAUDE.md'),
		join(cwd, '.mcp.json'),
		join(cwd, '.claude', 'settings.json'),
		join(cwd, '.claude', 'settings.local.json'),
		join(cwd, '.claude', 'CLAUDE.md'),
		join(cwd, 'CLAUDE.md'),
		join(cwd, 'CLAUDE.local.md'),
		join(cwd, 'AGENTS.md'),
	];
}

function fileStamp(path: string): string {
	try {
		const { mtimeMs, size } = statSync(path);
		return `${mtimeMs}:${size}`;
	} catch {
		return 'missing';
	}
}
