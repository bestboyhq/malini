import {
	mkdir,
	mkdtemp,
	readdir,
	readFile as readBytes,
	rm,
	stat,
	symlink,
	writeFile as writeBytes,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	globMatches,
	listFiles,
	normalizedRelativePath,
	readFile,
	readRepositoryFile,
	statFile,
	validateOwner,
	writeFile,
} from './files';
import type { CheckoutResolver } from '$shared/repositories/repositories.platform';

const dirs: string[] = [];
async function tempdir(label: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), `malini-ext-files-${label}-`));
	dirs.push(dir);
	return dir;
}
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function resolver(input: {
	workstreams: Record<string, { projectId: string; path: string }>;
	projects: Record<string, { repoPath: string }>;
}): CheckoutResolver {
	const workstream = (id: string) => {
		const row = input.workstreams[id];
		if (!row) throw new Error(`Unknown extension workstream: ${id}`);
		return row;
	};
	return {
		resolveCheckout: async (id) => workstream(id).path,
		resolveRepositoryRoot: async (id) => {
			const row = workstream(id);
			const project = input.projects[row.projectId];
			if (!project) throw new Error(`Unknown repository project: ${row.projectId}`);
			return project.repoPath;
		},
	};
}

function repositoryResolver(repository: string, projects = true): CheckoutResolver {
	return resolver({
		workstreams: { 'workstream-1': { projectId: 'project-1', path: join(repository, 'worktree') } },
		projects: projects ? { 'project-1': { repoPath: repository } } : {},
	});
}

describe('repository reads', () => {
	it('follow the workstream project mapping to the root checkout', async () => {
		const repository = await tempdir('repo');
		await mkdir(join(repository, '.malini'));
		await writeBytes(join(repository, '.malini/repository.json'), '{"schemaVersion":1}');
		await expect(
			readRepositoryFile(repositoryResolver(repository), 'workstream-1', '.malini/repository.json'),
		).resolves.toBe('{"schemaVersion":1}');
	});

	it('reject parent traversal', async () => {
		const repository = await tempdir('repo');
		await expect(
			readRepositoryFile(repositoryResolver(repository), 'workstream-1', '../secret.txt'),
		).rejects.toThrow(
			'Extension workstream path must stay relative to its workstream: ../secret.txt',
		);
	});

	it('reject symlink escapes', async () => {
		const repository = await tempdir('repo');
		const outside = await tempdir('outside');
		await writeBytes(join(outside, 'secret.txt'), 'secret');
		await symlink(outside, join(repository, 'escape'));
		await expect(
			readRepositoryFile(repositoryResolver(repository), 'workstream-1', 'escape/secret.txt'),
		).rejects.toThrow('Extension workstream path resolves outside its workstream');
	});

	it('report unknown workstream and project mappings', async () => {
		const repository = await tempdir('repo');
		await expect(
			readRepositoryFile(repositoryResolver(repository), 'missing-workstream', 'README.md'),
		).rejects.toThrow('Unknown extension workstream: missing-workstream');
		await expect(
			readRepositoryFile(repositoryResolver(repository, false), 'workstream-1', 'README.md'),
		).rejects.toThrow('Unknown repository project: project-1');
	});
});

describe('workstream files', () => {
	it('reads, writes, stats and lists workstream-relative files', async () => {
		const root = await tempdir('ws');
		await writeBytes(join(root, 'README.md'), 'hello');
		await writeFile(root, 'src/new.ts', 'export const shipped = true;');
		await expect(readFile(root, 'README.md')).resolves.toBe('hello');
		await expect(readFile(root, './src//new.ts')).resolves.toBe('export const shipped = true;');
		await expect(statFile(root, 'src/new.ts')).resolves.toEqual({ kind: 'file', size: 28 });
		await expect(statFile(root, 'src')).resolves.toMatchObject({ kind: 'directory' });
		await expect(statFile(root, '')).resolves.toMatchObject({ kind: 'directory' });
		await expect(listFiles(root, '**/*.ts')).resolves.toEqual(['src/new.ts']);
		await expect(listFiles(root)).resolves.toEqual(['README.md', 'src/new.ts']);
		await expect(listFiles(root, '')).resolves.toEqual(['README.md', 'src/new.ts']);
		await expect(statFile(root, 'missing.txt')).resolves.toBeNull();
	});

	it('names the file in read errors', async () => {
		const root = await tempdir('ws');
		await mkdir(join(root, 'dir'));
		await expect(readFile(root, 'missing.txt')).rejects.toThrow(
			'Extension workstream file does not exist: missing.txt',
		);
		await expect(readFile(root, 'dir')).rejects.toThrow(
			'Extension workstream path is not a file: dir',
		);
		await expect(readFile(root, '')).rejects.toThrow('Extension workstream path cannot be empty');
		await writeBytes(join(root, 'binary.bin'), Buffer.from([0xff, 0xfe, 0x00, 0xc3]));
		await expect(readFile(root, 'binary.bin')).rejects.toThrow(
			/^Could not read extension workstream file binary\.bin: /,
		);
	});

	it('atomically replaces an existing file without leaving staging files', async () => {
		const root = await tempdir('ws');
		const configuration = join(root, '.malini/workspace.json');
		await mkdir(join(root, '.malini'));
		await writeBytes(configuration, '{"schemaVersion":1,"extensions":{}}');
		const replacement = '{"schemaVersion":1,"extensions":{"malini.linear":{"enabled":true}}}';
		await writeFile(root, '.malini/workspace.json', replacement);
		await expect(readBytes(configuration, 'utf8')).resolves.toBe(replacement);
		await expect(readdir(join(root, '.malini'))).resolves.toEqual(['workspace.json']);
	});

	it('keeps the mode of a replaced file and gives a new one 0644', async () => {
		const root = await tempdir('ws');
		await writeBytes(join(root, 'run.sh'), '#!/bin/sh\n', { mode: 0o755 });
		await writeFile(root, 'run.sh', '#!/bin/sh\necho hi\n');
		expect((await stat(join(root, 'run.sh'))).mode & 0o777).toBe(0o755);
		await writeFile(root, 'plain.txt', 'x');
		expect((await stat(join(root, 'plain.txt'))).mode & 0o777).toBe(0o644);
	});

	it('listing skips generated, dependency, build and agent scratch trees', async () => {
		const root = await tempdir('ws');
		for (const directory of [
			'node_modules/pkg',
			'target/debug',
			'.svelte-kit/output',
			'.git/x',
			'.malini/sandbox/tmp',
			'.malini/agent-attachments/a',
		]) {
			await mkdir(join(root, directory), { recursive: true });
			await writeBytes(join(root, directory, 'package.json'), '{}');
		}
		await mkdir(join(root, 'apps/web'), { recursive: true });
		await writeBytes(join(root, 'apps/web/package.json'), '{}');
		await writeBytes(join(root, '.malini/package.json'), '{}');
		await expect(listFiles(root, '**/package.json')).resolves.toEqual([
			'.malini/package.json',
			'apps/web/package.json',
		]);
	});

	it('rejects absolute and parent traversal paths', async () => {
		const root = await tempdir('ws');
		await expect(readFile(root, '../secret.txt')).rejects.toThrow(
			'Extension workstream path must stay relative to its workstream: ../secret.txt',
		);
		await expect(writeFile(root, 'a/../../secret.txt', 'nope')).rejects.toThrow(
			'Extension workstream path must stay relative to its workstream: a/../../secret.txt',
		);
		await expect(statFile(root, '/etc/passwd')).rejects.toThrow(
			'Extension workstream path must stay relative to its workstream: /etc/passwd',
		);
		await expect(statFile(root, 'a\0b')).rejects.toThrow(
			'Extension workstream path contains a null byte',
		);
	});

	it('rejects symlink escapes for reads, stats and writes', async () => {
		const root = await tempdir('ws');
		const outside = await tempdir('outside');
		await writeBytes(join(outside, 'secret.txt'), 'secret');
		await symlink(outside, join(root, 'escape'));
		await expect(readFile(root, 'escape/secret.txt')).rejects.toThrow(
			'Extension workstream path resolves outside its workstream',
		);
		await expect(statFile(root, 'escape/secret.txt')).rejects.toThrow(
			'Extension workstream path resolves outside its workstream',
		);
		await expect(writeFile(root, 'escape/created.txt', 'nope')).rejects.toThrow(
			'Extension workstream writes cannot traverse symbolic links',
		);
		await expect(stat(join(outside, 'created.txt'))).rejects.toThrow();
		await expect(listFiles(root)).resolves.toEqual([]);
	});

	it('lists a symlinked file inside the workstream under its link name', async () => {
		const root = await tempdir('ws');
		await writeBytes(join(root, 'real.txt'), 'x');
		await symlink(join(root, 'real.txt'), join(root, 'link.txt'));
		await symlink(join(root, 'missing.txt'), join(root, 'dangling.txt'));
		await expect(listFiles(root)).resolves.toEqual(['link.txt', 'real.txt']);
		await expect(statFile(root, 'dangling.txt')).resolves.toBeNull();
	});

	it('refuses a symlink or a directory as the write target', async () => {
		const root = await tempdir('ws');
		const outside = await tempdir('outside');
		const outsideFile = join(outside, 'outside.txt');
		await writeBytes(outsideFile, 'unchanged');
		await symlink(outsideFile, join(root, 'linked.txt'));
		await expect(writeFile(root, 'linked.txt', 'changed')).rejects.toThrow(
			'Extension workstream writes cannot target symbolic links',
		);
		await expect(readBytes(outsideFile, 'utf8')).resolves.toBe('unchanged');
		await mkdir(join(root, 'dir'));
		await expect(writeFile(root, 'dir', 'x')).rejects.toThrow(
			'Extension workstream write target is a directory',
		);
		await writeBytes(join(root, 'file.txt'), 'x');
		await expect(writeFile(root, 'file.txt/child.txt', 'x')).rejects.toThrow(
			'Extension workstream write parent is not a directory',
		);
	});

	it('reports a missing or non-directory workstream root', async () => {
		await expect(readFile('/definitely/missing/malini-root', 'a')).rejects.toThrow(
			/^Could not resolve extension workstream: /,
		);
		const root = await tempdir('ws');
		await writeBytes(join(root, 'file'), 'x');
		await expect(listFiles(join(root, 'file'))).rejects.toThrow(
			'Extension workstream root is not a directory',
		);
	});
});

describe('validateOwner', () => {
	it('requires both ids', () => {
		expect(() => validateOwner('', 'ws')).toThrow(
			'Extension filesystem access requires an extension id',
		);
		expect(() => validateOwner('ext', ' ')).toThrow(
			'Extension filesystem access requires a workstream id',
		);
		expect(() => validateOwner('ext', 'ws')).not.toThrow();
	});
});

describe('normalizedRelativePath', () => {
	it('drops dot and empty segments and keeps the rest', () => {
		expect(normalizedRelativePath('./a//b/./c/', false)).toEqual(['a', 'b', 'c']);
		expect(normalizedRelativePath('', true)).toEqual([]);
		expect(normalizedRelativePath('.', true)).toEqual([]);
	});
});

describe('globMatches', () => {
	it('matches like the Rust host', () => {
		expect(globMatches('**/*.ts', 'src/new.ts')).toBe(true);
		expect(globMatches('**/*.ts', 'new.ts')).toBe(true);
		expect(globMatches('*.ts', 'src/new.ts')).toBe(false);
		expect(globMatches('src/*.ts', 'src/new.ts')).toBe(true);
		expect(globMatches('src/*.ts', 'src/deep/new.ts')).toBe(false);
		expect(globMatches('src/**', 'src/deep/new.ts')).toBe(true);
		expect(globMatches('src/**/*.ts', 'src/deep/er/new.ts')).toBe(true);
		expect(globMatches('src/?.ts', 'src/a.ts')).toBe(true);
		expect(globMatches('src/?.ts', 'src//.ts')).toBe(false);
		expect(globMatches('**/package.json', 'apps/web/package.json')).toBe(true);
		expect(globMatches('a', 'ab')).toBe(false);
	});
});
