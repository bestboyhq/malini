import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { join, posix, sep } from 'node:path';
import type { BrainDocument, BrainEntry, BrainEntryKind } from '$contract/brain';
import { errorCode } from '$main/errors';

const FOLDERS: Readonly<Record<BrainEntryKind, string>> = { note: 'notes', log: 'log' };

const TITLE = /^# +(.+?)\s*$/mu;

const LINK = /\[\[([^\]|#\n]+)(?:[|#][^\]\n]*)?\]\]/gu;

export const NOT_A_BRAIN_DOCUMENT = 'Only a .md file under notes/ or log/ opens here.';

export async function listBrainEntries(checkout: string): Promise<BrainEntry[]> {
	const [notes, logs] = await Promise.all([
		entriesOf(checkout, 'note'),
		entriesOf(checkout, 'log'),
	]);
	return [
		...notes.sort((left, right) => left.path.localeCompare(right.path)),
		...logs.sort((left, right) => right.path.localeCompare(left.path)),
	];
}

export async function readBrainDocument(checkout: string, path: string): Promise<BrainDocument> {
	const kind = documentKind(path);
	if (kind === null) throw new Error(NOT_A_BRAIN_DOCUMENT);
	const read = await readEntry(checkout, path, kind);
	if (read === null) throw new Error(`The brain has no ${path}.`);
	const target = path.slice(0, -'.md'.length);
	const notes = await Promise.all(
		(await markdownPaths(checkout, 'note')).map((note) => readEntry(checkout, note, 'note')),
	);
	const linkedFrom = notes.flatMap((note) =>
		note !== null && note.entry.path !== path && linksTo(note.text, target) ? [note.entry] : [],
	);
	return { ...read.entry, text: read.text, linkedFrom };
}

function documentKind(path: string): BrainEntryKind | null {
	if (path.includes('\\') || path.includes('\0') || posix.normalize(path) !== path) return null;
	if (!path.endsWith('.md') || path.split('/').some((part) => part === '..' || part === '')) {
		return null;
	}
	if (/^log\/[^/]+\.md$/u.test(path)) return 'log';
	return path.startsWith('notes/') ? 'note' : null;
}

function linksTo(text: string, target: string): boolean {
	return [...text.matchAll(LINK)].some((match) => match[1]?.trim() === target);
}

async function entriesOf(checkout: string, kind: BrainEntryKind): Promise<BrainEntry[]> {
	const entries = await Promise.all(
		(await markdownPaths(checkout, kind)).map((path) => readEntry(checkout, path, kind)),
	);
	return entries.flatMap((read) => (read === null ? [] : [read.entry]));
}

async function markdownPaths(checkout: string, kind: BrainEntryKind): Promise<string[]> {
	const folder = FOLDERS[kind];
	let names: string[];
	try {
		names = await readdir(join(checkout, folder), { recursive: kind === 'note' });
	} catch (error) {
		if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return [];
		throw error;
	}
	return names
		.map((name) => `${folder}/${name.split(sep).join('/')}`)
		.filter((path) => documentKind(path) === kind);
}

type ReadEntry = Readonly<{ entry: BrainEntry; text: string }>;

async function readEntry(
	checkout: string,
	path: string,
	kind: BrainEntryKind,
): Promise<ReadEntry | null> {
	const file = join(checkout, path);
	try {
		const info = await lstat(file);
		if (!info.isFile()) return null;
		const root = await realpath(checkout);
		if (!(await realpath(file)).startsWith(`${root}${sep}`)) return null;
		const text = await readFile(file, 'utf8');
		const stem = posix.basename(path, '.md');
		return {
			entry: {
				path,
				kind,
				title: TITLE.exec(text)?.[1] ?? stem,
				updatedAt: info.mtime.toISOString(),
			},
			text,
		};
	} catch (error) {
		if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return null;
		throw error;
	}
}
