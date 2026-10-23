import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isRecord } from '../type-guards.js';
import { claudeStateFile, claudeUserDirectory, userSettingsFile } from './user-settings.js';

export interface ConfigSnapshot {
	readonly cwd: string;
	readonly stamps: ReadonlyMap<string, string>;
}

const FOLDER_MCP_KEYS = [
	'mcpServers',
	'disabledMcpServers',
	'enabledMcpjsonServers',
	'disabledMcpjsonServers',
	'hasTrustDialogAccepted',
] as const;

export function configSnapshot(cwd: string, memoryFiles: readonly string[]): ConfigSnapshot {
	return snapshot(cwd, [...memoryFiles, ...memoryFilesOf(cwd), ...mcpConfigFiles(cwd)]);
}

export function mcpConfigSnapshot(cwd: string): ConfigSnapshot {
	return snapshot(cwd, mcpConfigFiles(cwd));
}

export function configChanged({ cwd, stamps }: ConfigSnapshot): boolean {
	for (const [path, stamp] of stamps) if (configStamp(cwd, path) !== stamp) return true;
	return false;
}

export function restamped(config: ConfigSnapshot, ...paths: readonly string[]): ConfigSnapshot {
	const stamps = new Map(config.stamps);
	for (const path of paths) if (stamps.has(path)) stamps.set(path, configStamp(config.cwd, path));
	return { cwd: config.cwd, stamps };
}

function snapshot(cwd: string, paths: readonly string[]): ConfigSnapshot {
	return { cwd, stamps: new Map(paths.map((path) => [path, configStamp(cwd, path)])) };
}

function memoryFilesOf(cwd: string): string[] {
	return [
		join(claudeUserDirectory(), 'CLAUDE.md'),
		join(cwd, '.claude', 'CLAUDE.md'),
		join(cwd, 'CLAUDE.md'),
		join(cwd, 'CLAUDE.local.md'),
		join(cwd, 'AGENTS.md'),
	];
}

function mcpConfigFiles(cwd: string): string[] {
	return [
		userSettingsFile(),
		claudeStateFile(),
		join(cwd, '.mcp.json'),
		join(cwd, '.claude', 'settings.json'),
		join(cwd, '.claude', 'settings.local.json'),
	];
}

function configStamp(cwd: string, path: string): string {
	return path === claudeStateFile() ? mcpStateStamp(cwd, path) : fileStamp(path);
}

function mcpStateStamp(cwd: string, path: string): string {
	let state: unknown;
	try {
		state = JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return fileStamp(path);
	}
	if (!isRecord(state)) return 'unreadable';
	const projects = isRecord(state['projects']) ? state['projects'] : {};
	const folder = projects[realFolder(cwd)];
	const folderMcp = FOLDER_MCP_KEYS.map((key) =>
		isRecord(folder) ? meaningful(folder[key]) : null,
	);
	return JSON.stringify([meaningful(state['mcpServers']), folderMcp]);
}

function meaningful(value: unknown): unknown {
	if (value === undefined || value === false) return null;
	if (Array.isArray(value)) return value.length === 0 ? null : value;
	if (isRecord(value)) return Object.keys(value).length === 0 ? null : value;
	return value;
}

function realFolder(cwd: string): string {
	try {
		return realpathSync(cwd);
	} catch {
		return cwd;
	}
}

function fileStamp(path: string): string {
	try {
		const { mtimeMs, size } = statSync(path);
		return `${mtimeMs}:${size}`;
	} catch {
		return 'missing';
	}
}
