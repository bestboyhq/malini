import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { APP_MANAGED_REPOSITORY_EXCLUDES, LEGACY_APP_MANAGED_REPOSITORY_EXCLUDES } from './paths';
import { GitError, isErrnoException } from '$main/errors';
import { atomicReplaceFile } from '$main/fs/atomic';
import { runGit } from './run';

let excludeWriteChain: Promise<void> = Promise.resolve();

export async function ensureAppManagedGitExcludes(worktreePath: string): Promise<void> {
	const reported = (
		await runGit([
			'-C',
			worktreePath,
			'rev-parse',
			'--path-format=absolute',
			'--git-path',
			'info/exclude',
		])
	).replace(/[\r\n]+$/, '');
	if (reported.length === 0) {
		throw GitError.git('git returned an empty repository exclude path');
	}
	let excludePath = isAbsolute(reported) ? reported : join(worktreePath, reported);
	try {
		const metadata = await lstat(excludePath);
		if (metadata.isSymbolicLink()) excludePath = await realpath(excludePath);
	} catch {}

	const previous = excludeWriteChain;
	const serialized = (async () => {
		await previous;
		let existing = '';
		try {
			existing = await readFile(excludePath, 'utf8');
		} catch (error) {
			if (!isErrnoException(error) || error.code !== 'ENOENT') {
				throw GitError.fromNodeError(error);
			}
		}
		const desired = repositoryExcludeWithManagedRule(existing);
		if (desired === existing) return;
		try {
			await atomicReplaceFile(excludePath, desired);
		} catch (error) {
			throw GitError.fromNodeError(error);
		}
	})();
	excludeWriteChain = serialized.catch(() => undefined);
	await serialized;
}

export async function ensureStagingPrecondition(worktreePath: string): Promise<void> {
	try {
		await ensureAppManagedGitExcludes(worktreePath);
	} catch (error) {
		console.error(
			`malini: could not install the repository exclude rule for \`${worktreePath}\`: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

export function repositoryExcludeWithManagedRule(existing: string): string {
	const managed = new Set<string>([
		...APP_MANAGED_REPOSITORY_EXCLUDES,
		...LEGACY_APP_MANAGED_REPOSITORY_EXCLUDES,
	]);
	let desired = '';
	for (const segment of splitInclusive(existing)) {
		const line = segment.replace(/[\r\n]+$/, '');
		if (!managed.has(line.trim())) desired += segment;
	}
	if (desired.length > 0 && !desired.endsWith('\n')) desired += '\n';
	for (const rule of APP_MANAGED_REPOSITORY_EXCLUDES) desired += `${rule}\n`;
	return desired;
}

function splitInclusive(text: string): string[] {
	const segments: string[] = [];
	let start = 0;
	for (let index = 0; index < text.length; index += 1) {
		if (text[index] === '\n') {
			segments.push(text.slice(start, index + 1));
			start = index + 1;
		}
	}
	if (start < text.length) segments.push(text.slice(start));
	return segments;
}
