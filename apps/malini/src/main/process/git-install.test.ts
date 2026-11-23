import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GIT_VERSION, gitBuild, gitHome, gitHomes, installGit, pruneGitHomes } from './git-install';

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratch(): string {
	const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'malini-git-install-')));
	roots.push(root);
	return root;
}

const BUILD = gitBuild('win32', 'x64');
const BYTES = new TextEncoder().encode('not a PortableGit');

describe('gitBuild', () => {
	it('picks the pinned PortableGit for each Windows chip and refuses any other OS', () => {
		expect(BUILD).toEqual({
			url: `https://github.com/git-for-windows/git/releases/download/v${GIT_VERSION}.windows.1/PortableGit-${GIT_VERSION}-64-bit.7z.exe`,
			sha256: '9dd04a608ceb5f6ab32a73709e0ecb159d211da71b697c45ff81f6dd0c6b49c7',
		});
		expect(gitBuild('win32', 'arm64')).toEqual({
			url: `https://github.com/git-for-windows/git/releases/download/v${GIT_VERSION}.windows.1/PortableGit-${GIT_VERSION}-arm64.7z.exe`,
			sha256: '0dca0d9f760924a7e6752235d7dd6eb1a9b508ee714b6ed15d89252e5a58c5c9',
		});
		expect(() => gitBuild('darwin', 'arm64')).toThrow(
			'Git for Windows has no build for darwin arm64',
		);
	});
});

describe('installGit', () => {
	it('names the stage that failed and leaves nothing behind, a crashed attempt included', async () => {
		const vendor = join(scratch(), 'vendor', 'git');
		mkdirSync(join(vendor, '.install-crashed'), { recursive: true });

		await expect(
			installGit(vendor, () => Promise.resolve(new Response('', { status: 404 })), {
				build: BUILD,
			}),
		).rejects.toMatchObject({
			name: 'GitInstallError',
			kind: 'download',
			message: 'Could not download Git for Windows: HTTP 404',
		});
		await expect(
			installGit(vendor, () => Promise.reject(new Error('net::ERR_NAME_NOT_RESOLVED')), {
				build: BUILD,
			}),
		).rejects.toMatchObject({ kind: 'download', message: /ERR_NAME_NOT_RESOLVED/u });
		await expect(
			installGit(vendor, () => Promise.resolve(new Response(BYTES)), { build: BUILD }),
		).rejects.toMatchObject({ kind: 'checksum' });
		await expect(
			installGit(vendor, () => Promise.resolve(new Response(BYTES)), {
				build: { url: BUILD.url, sha256: sha256(BYTES) },
			}),
		).rejects.toMatchObject({
			kind: 'unpack',
			message: /^Could not unpack Git for Windows: [A-Z]+$/u,
		});

		expect(readdirSync(vendor)).toEqual([]);
	});

	it('downloads nothing when the pinned Git is in place', async () => {
		const vendor = join(scratch(), 'vendor', 'git');
		mkdirSync(gitHome(vendor), { recursive: true });
		const asked: string[] = [];

		await installGit(
			vendor,
			(url) => {
				asked.push(url);
				return Promise.reject(new Error('no network in this test'));
			},
			{ build: BUILD },
		);

		expect(asked).toEqual([]);
	});
});

describe('gitHomes and pruneGitHomes', () => {
	it('keep an older Git usable until the pinned one is in, then remove the rest', async () => {
		const vendor = join(scratch(), 'vendor', 'git');
		expect(gitHomes(vendor)).toEqual([gitHome(vendor)]);
		for (const name of ['2.9.0', '2.10.1', '.install-x'])
			mkdirSync(join(vendor, name), { recursive: true });

		await pruneGitHomes(vendor);
		expect(gitHomes(vendor)).toEqual([
			gitHome(vendor),
			join(vendor, '2.10.1'),
			join(vendor, '2.9.0'),
		]);

		mkdirSync(gitHome(vendor));
		expect(gitHomes(vendor)).toEqual([gitHome(vendor)]);
		await pruneGitHomes(vendor);
		expect(readdirSync(vendor)).toEqual([GIT_VERSION]);
	});
});

describe.runIf(process.platform === 'win32')('installGit on Windows', () => {
	it(
		'unpacks the real PortableGit without a window into a git and a Git Bash that run',
		async () => {
			const archive = process.env['MALINI_TEST_PORTABLE_GIT'];
			expect(
				archive,
				'MALINI_TEST_PORTABLE_GIT names scripts/fetch-portable-git.mjs output',
			).toMatch(/PortableGit-.*\.7z\.exe$/u);
			const bytes = readFileSync(archive ?? '');
			const root = scratch();
			const vendor = join(root, 'vendor', 'git');
			const windows = await watchWindows(root);

			await installGit(vendor, () => Promise.resolve(new Response(bytes)), { build: gitBuild() });

			expect(await windows()).toEqual([]);
			const home = gitHome(vendor);
			expect(readdirSync(vendor)).toEqual([GIT_VERSION]);
			expect(execFileSync(join(home, 'cmd', 'git.exe'), ['--version'], { encoding: 'utf8' })).toBe(
				`git version ${GIT_VERSION}.windows.1\n`,
			);
			expect(
				execFileSync(join(home, 'bin', 'bash.exe'), ['-c', 'echo $((6 * 7))'], {
					encoding: 'utf8',
				}),
			).toBe('42\n');
			expect(existsSync(join(home, 'post-install.bat'))).toBe(false);
		},
		10 * 60_000,
	);
});

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

async function watchWindows(root: string): Promise<() => Promise<string[]>> {
	const script = [
		`$root = '${root.replaceAll("'", "''")}'`,
		"Write-Output 'watching'",
		'while ($true) {',
		'	Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and (($_.Path -and $_.Path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) -or $_.MainWindowTitle -match "post-install|PortableGit|Extracting") } | ForEach-Object { "$($_.ProcessName): $($_.MainWindowTitle)" }',
		'	Start-Sleep -Milliseconds 100',
		'}',
	].join('\n');
	const watcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
		windowsHide: true,
	});
	let seen = '';
	watcher.stdout.setEncoding('utf8');
	await new Promise<void>((resolve, reject) => {
		watcher.once('exit', (code) => reject(new Error(`The window watcher exited with ${code}`)));
		watcher.stdout.on('data', (chunk: string) => {
			seen += chunk;
			if (seen.includes('watching')) resolve();
		});
	});
	return async () => {
		expect(watcher.exitCode, 'the window watcher ran through the install').toBeNull();
		watcher.kill();
		await once(watcher, 'exit');
		return [...new Set(seen.split(/\r?\n/u).filter((line) => line !== '' && line !== 'watching'))];
	};
}
