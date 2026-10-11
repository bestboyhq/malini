import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const actionsMenuSource = readFileSync(
	new URL(
		'../../../shared/repositories/presentation/WorkstreamActionsMenu.svelte',
		import.meta.url,
	),
	'utf8',
);

function sourceFiles(root: URL): readonly string[] {
	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'platform') {
			continue;
		}
		if (entry.isDirectory()) {
			files.push(...sourceFiles(new URL(`${entry.name}/`, root)));
			continue;
		}
		if (!/\.(?:ts|svelte)$/u.test(entry.name)) continue;
		if (/\.(?:test|spec)\.ts$/u.test(entry.name)) continue;
		files.push(fileURLToPath(new URL(entry.name, root)));
	}
	return files;
}

describe('commit messages', () => {
	it('never commits with a hardcoded message', () => {
		const roots = [
			new URL('../../../../lib/', import.meta.url),
			new URL('../../../../renderer/', import.meta.url),
			new URL('../../../../../../../extensions/', import.meta.url),
		];
		const repositoryRoot = fileURLToPath(new URL('../../../../../../../', import.meta.url));
		const offenders = roots
			.flatMap((root) => sourceFiles(root))
			.filter((file) => /Agent changes/u.test(readFileSync(file, 'utf8')))
			.map((file) => file.slice(repositoryRoot.length));
		expect(offenders).toEqual([]);
	});

	it('derives the workstream menu commit message from the shared derivation', () => {
		expect(actionsMenuSource).toContain('commitWorkstreamCheckpointCommand(');
		expect(actionsMenuSource).not.toMatch(/commitWorkstreamCommand\(\s*workstreamId\s*,\s*['"`]/u);
	});
});
