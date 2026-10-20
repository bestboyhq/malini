import { describe, expect, it } from 'vitest';
import { basename, fileIconIdFor, fileIconUrl, folderIconIdFor } from './file-icon';
import {
	DEFAULT_FILE_ICON,
	DEFAULT_FOLDER_ICON,
	DEFAULT_FOLDER_OPEN_ICON,
	DEFAULT_ROOT_FOLDER_ICON,
} from '@malini/extension-api';

describe('material file icons', () => {
	it('reads the basename out of every path shape the app hands over', () => {
		expect(basename('apps/desktop/src/git.rs')).toBe('git.rs');
		expect(basename('/Users/dev/work/malini/package.json')).toBe('package.json');
		expect(basename('git.rs')).toBe('git.rs');
		expect(basename('src/lib/')).toBe('lib');
		expect(basename('C:\\work\\malini\\main.ts')).toBe('main.ts');
		expect(basename('')).toBe('');
	});

	it('prefers an exact filename over its extension', () => {
		expect(fileIconIdFor('package.json')).not.toBe(fileIconIdFor('tsconfig.other.json'));
		expect(fileIconIdFor('apps/desktop/package.json')).toBe(fileIconIdFor('package.json'));
		expect(fileIconIdFor('Dockerfile')).toBe(fileIconIdFor('dockerfile'));
	});

	it('matches the longest extension before the shortest', () => {
		expect(fileIconIdFor('agent.test.ts')).not.toBe(fileIconIdFor('agent.ts'));
		expect(fileIconIdFor('a/b/agent.test.ts')).toBe(fileIconIdFor('agent.test.ts'));
		expect(fileIconIdFor('bundle.ts.map')).not.toBe(fileIconIdFor('bundle.ts'));
	});

	it('resolves a dotfile by name first, then by its own segment', () => {
		expect(fileIconIdFor('.gitignore')).not.toBe(DEFAULT_FILE_ICON);
		expect(fileIconIdFor('.env.example')).not.toBe(DEFAULT_FILE_ICON);
		expect(fileIconIdFor('.env')).not.toBe(DEFAULT_FILE_ICON);
		expect(fileIconIdFor('.env')).toBe(fileIconIdFor('config.env'));
	});

	it('falls back rather than guessing', () => {
		expect(fileIconIdFor('notes.qqqzz')).toBe(DEFAULT_FILE_ICON);
		expect(fileIconIdFor('LICENSE-not-a-real-name')).toBe(DEFAULT_FILE_ICON);
		expect(fileIconIdFor('')).toBe(DEFAULT_FILE_ICON);
	});

	it('is case-insensitive, because a repository is not', () => {
		expect(fileIconIdFor('README.MD')).toBe(fileIconIdFor('readme.md'));
		expect(fileIconIdFor('Main.RS')).toBe(fileIconIdFor('main.rs'));
	});

	it('resolves the languages an agent transcript actually shows', () => {
		const distinct = new Set(
			['a.ts', 'a.tsx', 'a.rs', 'a.py', 'a.go', 'a.svelte', 'a.json', 'a.css', 'a.sql'].map(
				fileIconIdFor,
			),
		);
		expect(distinct.size).toBe(9);
		expect(distinct.has(DEFAULT_FILE_ICON)).toBe(false);
	});

	it('names folders in both disclosure states', () => {
		expect(folderIconIdFor('src')).not.toBe(DEFAULT_FOLDER_ICON);
		expect(folderIconIdFor('apps/desktop/src')).toBe(folderIconIdFor('src'));
		const open = folderIconIdFor('src', { expanded: true });
		expect(open).not.toBe(DEFAULT_FOLDER_OPEN_ICON);
		expect(open).not.toBe(folderIconIdFor('src'));
		expect(open).toMatch(/-open$/u);
		expect(folderIconIdFor('zzz-not-a-known-folder')).toBe(DEFAULT_FOLDER_ICON);
		expect(folderIconIdFor('zzz-not-a-known-folder', { expanded: true })).toBe(
			DEFAULT_FOLDER_OPEN_ICON,
		);
		expect(folderIconIdFor('anything', { root: true })).toBe(DEFAULT_ROOT_FOLDER_ICON);
		expect(folderIconIdFor('anything', { root: true, expanded: true })).not.toBe(
			DEFAULT_ROOT_FOLDER_ICON,
		);
	});

	it('points at the vendored asset path', () => {
		expect(fileIconUrl('typescript')).toMatch(/\/file-icons\/typescript\.svg$/u);
	});
});
