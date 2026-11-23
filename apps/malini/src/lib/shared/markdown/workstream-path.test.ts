import { describe, expect, it } from 'vitest';
import { relativizeWorkstreamCommand, relativizeWorkstreamPath } from './workstream-path';

const ROOT = '/Users/me/Library/Application Support/malini/workstreams/01JABC';

describe('relativizeWorkstreamPath', () => {
	it('strips workstreams checkout prefixes for display', () => {
		expect(
			relativizeWorkstreamPath(
				'/Users/me/Library/Application Support/com.malini.app/workstreams/01JABC/src/server.js',
			),
		).toBe('src/server.js');
	});

	it('keeps legacy checkout prefixes supported', () => {
		expect(
			relativizeWorkstreamPath(
				'/Users/me/Library/Application Support/com.malini.app/worktrees/01JABC/src/server.js',
			),
		).toBe('src/server.js');
	});

	it('strips a Windows checkout prefix and keeps a path outside any workstream as written', () => {
		expect(
			relativizeWorkstreamPath(
				'C:\\Users\\me\\AppData\\Roaming\\malini\\workstreams\\01JABC\\src\\server.js',
			),
		).toBe('src/server.js');
		expect(relativizeWorkstreamPath('C:\\Users\\me\\notes.md')).toBe('C:\\Users\\me\\notes.md');
	});
});

describe('relativizeWorkstreamCommand', () => {
	it('relativizes quoted and escaped paths anywhere in the command', () => {
		const escaped = ROOT.replace(' ', '\\ ');
		expect(relativizeWorkstreamCommand(`cd "${ROOT}" && cat '${ROOT}/a b.ts'`)).toBe(
			"cd . && cat 'a b.ts'",
		);
		expect(relativizeWorkstreamCommand(`git -C ${escaped}/ log && cat ${escaped}/a.ts`)).toBe(
			'git -C . log && cat a.ts',
		);
		expect(relativizeWorkstreamCommand(`echo "a" && grep x "${ROOT}/src" "b"`)).toBe(
			'echo "a" && grep x "src" "b"',
		);
	});

	it('relativizes Windows paths, whichever separator they use', () => {
		const windowsRoot = 'C:\\Users\\me\\AppData\\Roaming\\malini\\workstreams\\01JABC';
		expect(
			relativizeWorkstreamCommand(`cd "${windowsRoot}" && cat "${windowsRoot}\\src\\a.ts"`),
		).toBe('cd . && cat "src\\a.ts"');
		expect(relativizeWorkstreamCommand(`git -C ${windowsRoot.replaceAll('\\', '/')}/src log`)).toBe(
			'git -C src log',
		);
	});

	it('leaves paths outside a workstream alone', () => {
		expect(relativizeWorkstreamCommand('cd /tmp && ls .git/worktrees/x')).toBe(
			'cd /tmp && ls .git/worktrees/x',
		);
	});
});
