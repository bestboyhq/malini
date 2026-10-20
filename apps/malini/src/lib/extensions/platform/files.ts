import { lstat, mkdir, readFile as readFileBytes, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describeError, errorCode } from '$main/errors';
import { atomicReplaceFile } from '$main/fs/atomic';
import { isAtOrInsideDirectory, SKIPPED_DIRECTORIES } from '$main/fs/paths';
import { listWorkstreamFiles, type WorkstreamFileEntry } from '$main/git/diff';
import type { CheckoutResolver } from '$shared/repositories/repositories.platform';
import type { ExtensionFileKind, ExtensionFileStat } from '$contract/system';

export type { ExtensionFileKind, ExtensionFileStat };

export function validateOwner(extensionId: string, workstreamId: string): void {
	if (typeof extensionId !== 'string' || extensionId.trim() === '') {
		throw new Error('Extension filesystem access requires an extension id');
	}
	if (typeof workstreamId !== 'string' || workstreamId.trim() === '') {
		throw new Error('Extension filesystem access requires a workstream id');
	}
}

async function canonicalWorkstreamRoot(root: string): Promise<string> {
	let canonical: string;
	try {
		canonical = await realpath(root);
	} catch (error) {
		throw new Error(`Could not resolve extension workstream: ${describeError(error)}`);
	}
	if (!(await stat(canonical)).isDirectory()) {
		throw new Error('Extension workstream root is not a directory');
	}
	return canonical;
}

export function normalizedRelativePath(path: string, allowEmpty: boolean): string[] {
	if (path.includes('\0')) {
		throw new Error('Extension workstream path contains a null byte');
	}
	if (path.startsWith('/')) {
		throw new Error(`Extension workstream path must stay relative to its workstream: ${path}`);
	}
	const segments: string[] = [];
	for (const segment of path.split('/')) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..') {
			throw new Error(`Extension workstream path must stay relative to its workstream: ${path}`);
		}
		segments.push(segment);
	}
	if (!allowEmpty && segments.length === 0) {
		throw new Error('Extension workstream path cannot be empty');
	}
	return segments;
}

function isNotFound(error: unknown): boolean {
	return errorCode(error) === 'ENOENT';
}

async function containedCanonicalTarget(root: string, segments: string[]): Promise<string | null> {
	const target = join(root, ...segments);
	let canonical: string;
	try {
		canonical = await realpath(target);
	} catch (error) {
		if (isNotFound(error)) return null;
		throw new Error(`Could not resolve extension workstream path: ${describeError(error)}`);
	}
	if (!isAtOrInsideDirectory(root, canonical)) {
		throw new Error('Extension workstream path resolves outside its workstream');
	}
	return canonical;
}

export async function readFile(root: string, path: string): Promise<string> {
	const canonicalRoot = await canonicalWorkstreamRoot(root);
	const relative = normalizedRelativePath(path, false);
	const target = await containedCanonicalTarget(canonicalRoot, relative);
	if (target === null) {
		throw new Error(`Extension workstream file does not exist: ${path}`);
	}
	if (!(await stat(target)).isFile()) {
		throw new Error(`Extension workstream path is not a file: ${path}`);
	}
	try {
		const bytes = await readFileBytes(target);
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (error) {
		throw new Error(`Could not read extension workstream file ${path}: ${describeError(error)}`);
	}
}

export async function readRepositoryFile(
	resolver: CheckoutResolver,
	workstreamId: string,
	path: string,
): Promise<string> {
	const root = await resolver.resolveRepositoryRoot(workstreamId);
	return readFile(root, path);
}

export async function statFile(root: string, path: string): Promise<ExtensionFileStat | null> {
	const canonicalRoot = await canonicalWorkstreamRoot(root);
	const relative = normalizedRelativePath(path, true);
	const target = await containedCanonicalTarget(canonicalRoot, relative);
	if (target === null) return null;
	let metadata;
	try {
		metadata = await stat(target);
	} catch (error) {
		throw new Error(`Could not stat extension workstream path ${path}: ${describeError(error)}`);
	}
	if (metadata.isDirectory()) return { kind: 'directory', size: metadata.size };
	if (metadata.isFile()) return { kind: 'file', size: metadata.size };
	return null;
}

export async function writeFile(root: string, path: string, contents: string): Promise<void> {
	const canonicalRoot = await canonicalWorkstreamRoot(root);
	const relative = normalizedRelativePath(path, false);
	const target = await prepareWriteTarget(canonicalRoot, relative);
	try {
		await atomicReplaceFile(target, contents);
	} catch (error) {
		throw new Error(`Could not write extension workstream file ${path}: ${describeError(error)}`);
	}
}

async function prepareWriteTarget(root: string, segments: string[]): Promise<string> {
	let directory = root;
	const fileName = segments[segments.length - 1];
	if (fileName === undefined) {
		throw new Error('Extension workstream write path is not normalized');
	}
	for (const segment of segments.slice(0, -1)) {
		const candidate = join(directory, segment);
		let metadata;
		try {
			metadata = await lstat(candidate);
		} catch (error) {
			if (!isNotFound(error)) {
				throw new Error(
					`Could not inspect extension workstream directory: ${describeError(error)}`,
				);
			}
			try {
				await mkdir(candidate);
			} catch (mkdirError) {
				throw new Error(
					`Could not create extension workstream directory: ${describeError(mkdirError)}`,
				);
			}
		}
		if (metadata?.isSymbolicLink()) {
			throw new Error('Extension workstream writes cannot traverse symbolic links');
		}
		if (metadata && !metadata.isDirectory()) {
			throw new Error('Extension workstream write parent is not a directory');
		}
		try {
			directory = await realpath(candidate);
		} catch (error) {
			throw new Error(`Could not resolve extension workstream directory: ${describeError(error)}`);
		}
		if (!isAtOrInsideDirectory(root, directory)) {
			throw new Error('Extension workstream write resolves outside its workstream');
		}
	}

	const target = join(directory, fileName);
	let metadata;
	try {
		metadata = await lstat(target);
	} catch (error) {
		if (isNotFound(error)) return target;
		throw new Error(`Could not inspect extension workstream write target: ${describeError(error)}`);
	}
	if (metadata.isSymbolicLink()) {
		throw new Error('Extension workstream writes cannot target symbolic links');
	}
	if (metadata.isDirectory()) {
		throw new Error('Extension workstream write target is a directory');
	}
	const canonical = await realpath(target);
	if (!isAtOrInsideDirectory(root, canonical)) {
		throw new Error('Extension workstream write resolves outside its workstream');
	}
	return target;
}

export async function listFiles(root: string, glob?: string | null): Promise<string[]> {
	const canonicalRoot = await canonicalWorkstreamRoot(root);
	let listed: readonly WorkstreamFileEntry[];
	try {
		listed = await listWorkstreamFiles(canonicalRoot);
	} catch (error) {
		throw new Error(`Could not list extension workstream files: ${describeError(error)}`);
	}
	const candidates = listed
		.map(({ path }) => path)
		.filter((path) => !path.split('/').some((segment) => SKIPPED_DIRECTORIES.has(segment)))
		.filter((path) => !glob || globMatches(glob, path));
	const listable = await Promise.all(candidates.map((path) => isListableFile(canonicalRoot, path)));
	return candidates.filter((_path, index) => listable[index]);
}

async function isListableFile(root: string, path: string): Promise<boolean> {
	const absolute = join(root, path);
	let metadata;
	try {
		metadata = await lstat(absolute);
	} catch (error) {
		if (isNotFound(error)) return false;
		throw new Error(`Could not inspect extension workstream path: ${describeError(error)}`);
	}
	if (!metadata.isSymbolicLink()) return metadata.isFile();
	try {
		const canonical = await realpath(absolute);
		return isAtOrInsideDirectory(root, canonical) && (await stat(canonical)).isFile();
	} catch {
		return false;
	}
}

export function globMatches(pattern: string, value: string): boolean {
	const p = Array.from(pattern);
	const v = Array.from(value);
	const memo = new Map<number, boolean>();
	const stride = v.length + 1;
	const matches = (pi: number, vi: number): boolean => {
		const key = pi * stride + vi;
		const cached = memo.get(key);
		if (cached !== undefined) return cached;
		let result: boolean;
		if (pi === p.length) {
			result = vi === v.length;
		} else if (p[pi] === '*') {
			if (p[pi + 1] === '*') {
				const afterStars = pi + 2;
				const next = p[afterStars] === '/' ? afterStars + 1 : afterStars;
				result = matches(next, vi) || (vi < v.length && matches(pi, vi + 1));
			} else {
				result = matches(pi + 1, vi) || (vi < v.length && v[vi] !== '/' && matches(pi, vi + 1));
			}
		} else {
			result =
				vi < v.length &&
				((p[pi] === '?' && v[vi] !== '/') || p[pi] === v[vi]) &&
				matches(pi + 1, vi + 1);
		}
		memo.set(key, result);
		return result;
	};
	return matches(0, 0);
}
