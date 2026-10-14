import { describe, expect, it } from 'vitest';
import { updateFromMainJobContext } from './update-from-main-context';

describe('the update-from-main job context', () => {
	const input = {
		branch: 'malini/ws-1',
		baseBranch: 'main',
		conflictedPaths: ['src/shared.ts'],
		conflictMarkerPaths: ['src/shared.ts'],
	};

	it('lists the conflicted files and the branches, with no remote data', () => {
		const context = updateFromMainJobContext(input);

		expect(context).toContain('Conflicted files:\n- src/shared.ts\n');
		expect(context).toContain('Branch: malini/ws-1');
		expect(context).toContain('Base branch: main');
		expect(context).not.toContain('MERGE_HEAD');
		expect(context).not.toContain('BEGIN_UNTRUSTED_REMOTE_DIAGNOSTIC_DATA');
	});

	it('says how to settle a conflicted file that carries no markers', () => {
		const context = updateFromMainJobContext({
			...input,
			conflictedPaths: ['src/shared.ts', 'assets/logo.png'],
		});

		expect(context).toContain(
			'- assets/logo.png (no conflict markers: binary, or deleted on one side)',
		);
		expect(context).toContain('`git show MERGE_HEAD:<path>` prints it');
	});

	it('sanitizes conflicted paths and caps how many it names', () => {
		const conflictedPaths = [
			'src/\u001b[31mescaped‮.ts',
			...Array.from({ length: 60 }, (_, index) => `src/file-${index}.ts`),
		];
		const context = updateFromMainJobContext({
			...input,
			conflictedPaths,
			conflictMarkerPaths: conflictedPaths,
		});
		const files = context.split('\n').filter((entry) => entry.startsWith('- '));

		expect(files).toHaveLength(41);
		expect(files.join('\n')).not.toContain('\u001b');
		expect(files.join('\n')).not.toContain('‮');
		expect(files.at(-1)).toBe('- and 21 more');
	});
});
