import { isAbsolute, relative } from 'node:path';

export function isInsideDirectory(root: string, path: string): boolean {
	const between = relative(root, path);
	return between !== '' && !between.startsWith('..') && !isAbsolute(between);
}

export function isAtOrInsideDirectory(root: string, path: string): boolean {
	return path === root || isInsideDirectory(root, path);
}

export const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
	'.git',
	'node_modules',
	'target',
	'dist',
	'build',
	'coverage',
	'.svelte-kit',
	'.next',
	'.turbo',
]);
