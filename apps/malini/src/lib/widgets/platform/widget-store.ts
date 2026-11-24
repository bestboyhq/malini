import { createHash, randomUUID } from 'node:crypto';
import { existsSync, type Dirent } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { WIDGETS_FOLDER, type WidgetDefinition } from '$contract/widgets';
import { describeError, errorCode } from '$main/errors';
import { recordedRemoteBase } from '$main/git/remote';
import { runGit, runGitBoundedStdout } from '$main/git/run';
import { isWidgetId, readWidgetFile, writeWidgetFile } from './widget-files';

const WIDGET_FILES_MAX = 64;
const WIDGET_FILE_MAX_BYTES = 256 * 1024;
const LISTED_FILE = /^(100644|100755) blob ([0-9a-f]+) +(\d+)\t(.+)$/u;

export type SharedBase = Readonly<{ repoPath: string; branch: string }>;

type Skip = (path: string, problem: string) => void;

export function storeRoot(appDataRoot: string, board: string): string {
	const key = createHash('sha256').update(board.toLowerCase()).digest('hex').slice(0, 24);
	return join(appDataRoot, 'widgets', key);
}

export function mineHome(root: string, id: string): string {
	return join(root, 'mine', id);
}

export async function readMine(root: string, skip: Skip): Promise<WidgetDefinition[]> {
	const ids = (await entries(join(root, 'mine')))
		.filter((entry) => entry.isDirectory() && isWidgetId(entry.name))
		.map((entry) => entry.name);
	const widgets = await Promise.all(
		ids.map(async (id) => {
			try {
				return [await readWidgetFile(mineHome(root, id), id, 'mine')];
			} catch (error) {
				skip(mineHome(root, id), describeError(error));
				return [];
			}
		}),
	);
	return widgets.flat().sort((left, right) => left.id.localeCompare(right.id));
}

export async function writeMine(
	root: string,
	widget: WidgetDefinition,
	helpersFrom: string,
): Promise<void> {
	const home = mineHome(root, widget.id);
	const stage = join(root, 'mine', `.${widget.id}-${randomUUID()}`);
	try {
		const folder = join(stage, WIDGETS_FOLDER);
		await copyHelpers(join(home, WIDGETS_FOLDER), folder);
		await copyHelpers(join(helpersFrom, WIDGETS_FOLDER), folder);
		await writeWidgetFile(stage, widget);
		const old = join(dirname(home), `.${basename(home)}-${randomUUID()}`);
		await rename(home, old).catch((error: unknown) => {
			if (errorCode(error) !== 'ENOENT') throw error;
		});
		await rename(stage, home);
		await rm(old, { recursive: true, force: true });
	} finally {
		await rm(stage, { recursive: true, force: true });
	}
}

export function deleteMine(root: string, id: string): Promise<void> {
	return rm(mineHome(root, id), { recursive: true, force: true });
}

export async function copyWidgetFiles(home: string, checkout: string): Promise<void> {
	const from = join(home, WIDGETS_FOLDER);
	const to = join(checkout, WIDGETS_FOLDER);
	await mkdir(to, { recursive: true });
	for (const entry of await entries(from)) {
		if (entry.isFile()) await copyFile(join(from, entry.name), join(to, entry.name));
	}
}

export async function sharedTree(base: SharedBase): Promise<string | null> {
	try {
		const ref = await recordedRemoteBase(base.repoPath, base.branch);
		if (ref === null) return null;
		const tree = await runGit([
			'-C',
			base.repoPath,
			'rev-parse',
			'--verify',
			'--quiet',
			`${ref}:${WIDGETS_FOLDER}`,
		]);
		return tree.trim() || null;
	} catch {
		return null;
	}
}

export async function materializeShared(
	root: string,
	base: SharedBase,
	tree: string,
): Promise<string> {
	const shared = join(root, 'shared');
	const home = join(shared, tree);
	if (existsSync(home)) return home;
	const stage = join(shared, `.${tree}-${randomUUID()}`);
	try {
		const folder = join(stage, WIDGETS_FOLDER);
		await mkdir(folder, { recursive: true });
		const listing = await runGit(['-C', base.repoPath, 'ls-tree', '-z', '-l', tree]);
		const files = listing
			.split('\0')
			.flatMap((line) => {
				const listed = LISTED_FILE.exec(line);
				return listed === null ? [] : [listed];
			})
			.slice(0, WIDGET_FILES_MAX);
		for (const [, mode, blob = '', size, name = ''] of files) {
			if (Number(size) > WIDGET_FILE_MAX_BYTES || name.startsWith('.')) continue;
			const text = await runGitBoundedStdout(
				['-C', base.repoPath, 'cat-file', 'blob', blob],
				WIDGET_FILE_MAX_BYTES,
				'a shared widget file',
			).catch(() => null);
			if (text === null) continue;
			await writeFile(join(folder, name), text, { mode: mode === '100755' ? 0o755 : 0o644 });
		}
		await rename(stage, home).catch((error: unknown) => {
			if (!existsSync(home)) throw error;
		});
		for (const entry of await entries(shared)) {
			if (entry.name !== tree && !entry.name.startsWith('.')) {
				await rm(join(shared, entry.name), { recursive: true, force: true });
			}
		}
	} finally {
		await rm(stage, { recursive: true, force: true });
	}
	return home;
}

async function copyHelpers(from: string, to: string): Promise<void> {
	await mkdir(to, { recursive: true });
	let copied = 0;
	for (const entry of await entries(from)) {
		if (!entry.isFile() || entry.name.startsWith('.') || entry.name.endsWith('.json')) continue;
		const source = join(from, entry.name);
		if ((await stat(source)).size > WIDGET_FILE_MAX_BYTES) continue;
		if ((copied += 1) > WIDGET_FILES_MAX) return;
		await copyFile(source, join(to, entry.name));
	}
}

async function entries(folder: string): Promise<Dirent[]> {
	try {
		return await readdir(folder, { withFileTypes: true });
	} catch (error) {
		if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return [];
		throw error;
	}
}
