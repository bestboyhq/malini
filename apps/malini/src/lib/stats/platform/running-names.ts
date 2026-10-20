import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { RunningItemKind } from '$contract/stats';
import { isRecord } from '$main/db/rows';

export type ServiceName = Readonly<{ name: string; kind: RunningItemKind }>;

const LEADING_CD = /^\s*cd\s+(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))\s*&&\s*/u;
const TASK_REPLY = /^task\s*:\s*/iu;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const RUNNERS = new Set(['npx', 'pnpm', 'npm', 'bun', 'bunx', 'yarn']);
const RUNNER_VERBS = new Set(['run', 'exec', 'x', 'dlx']);
const PREFIXES = new Set(['exec', 'env']);

export function namingTask(
	description: string,
	command: string,
	packageName: string | null,
): string {
	return [
		`Description: ${description}`,
		`Command: ${command}`,
		...(packageName === null ? [] : [`Package: ${packageName}`]),
	].join('\n');
}

export function parseServiceName(reply: string): ServiceName | null {
	const line = reply.trim().toLowerCase();
	const kind: RunningItemKind = TASK_REPLY.test(line) ? 'task' : 'service';
	const name = line.replace(TASK_REPLY, '').trim();
	return name === '' ? null : { name, kind };
}

export function commandDetail(command: string): string {
	return command.replace(LEADING_CD, '').trim();
}

export function commandDirectory(command: string, workstreamPath: string): string {
	const match = LEADING_CD.exec(command);
	const directory = match?.[1] ?? match?.[2] ?? match?.[3];
	return directory === undefined ? workstreamPath : resolve(workstreamPath, directory);
}

export function fallbackServiceName(command: string, packageName: string | null): string {
	return packageName ?? programName(command) ?? 'command';
}

export function programName(command: string): string | null {
	let rest = command;
	while (LEADING_CD.test(rest)) rest = rest.replace(LEADING_CD, '');
	let afterRunner = false;
	for (const word of rest.trim().split(/\s+/u)) {
		if (word === '' || ENV_ASSIGNMENT.test(word) || PREFIXES.has(word)) continue;
		if (RUNNERS.has(word)) {
			afterRunner = true;
			continue;
		}
		if (afterRunner && (word.startsWith('-') || RUNNER_VERBS.has(word))) continue;
		const program = (word.replaceAll(/["']/gu, '').split('/').pop() ?? '').replace(/@.*$/u, '');
		return program === '' ? null : program.toLowerCase();
	}
	return null;
}

export function folderName(directory: string, workstreamPath: string): string | null {
	const name = nearestPackageName(directory, workstreamPath);
	if (directory === workstreamPath) return name;
	return name === null || name === nearestPackageName(workstreamPath, workstreamPath)
		? basename(directory)
		: name;
}

export function nearestPackageName(directory: string, workstreamPath: string): string | null {
	for (let folder = directory; ; folder = dirname(folder)) {
		const name = packageName(join(folder, 'package.json'));
		if (name !== null) return name;
		const parent = dirname(folder);
		const leavesWorkstream =
			parent !== workstreamPath && !parent.startsWith(`${workstreamPath}${sep}`);
		if (folder === workstreamPath || parent === folder || leavesWorkstream) return null;
	}
}

function packageName(file: string): string | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return null;
	}
	const name = isRecord(parsed) ? parsed['name'] : undefined;
	if (typeof name !== 'string') return null;
	const unscoped = name.replace(/^@[^/]+\//u, '').trim();
	return unscoped === '' ? null : unscoped;
}
