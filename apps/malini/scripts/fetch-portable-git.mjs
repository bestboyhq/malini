import { createHash } from 'node:crypto';
import { mkdirSync, renameSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveDownload } from '../src/main/fs/download.ts';
import { gitBuild } from '../src/main/process/git-install.ts';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const folder = resolve(process.argv[2] ?? '.');
	const build = gitBuild('win32', process.arch);
	const archive = join(folder, basename(new URL(build.url).pathname));
	mkdirSync(folder, { recursive: true });
	if ((await sha256(archive)) !== build.sha256) {
		const partial = `${archive}.partial`;
		const actual = await saveDownload(fetch, build.url, partial, { onProgress: () => {} });
		if (actual !== build.sha256) {
			throw new Error(`${build.url} has sha256 ${actual}, expected ${build.sha256}`);
		}
		renameSync(partial, archive);
	}
	console.log(archive);
}

/** @param {string} file */
async function sha256(file) {
	const bytes = await readFile(file).catch(() => null);
	return bytes && createHash('sha256').update(bytes).digest('hex');
}
