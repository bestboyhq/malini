import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	git,
	invoke,
	launchMalini,
	moveFoldersMaliniHolds,
	openWorkstream,
	seedWorkstream,
} from './harness';

const WORKSTREAM_ID = 'e2e-base-reclone-ws';

test('a workstream whose base clone is gone clones it again and links back, asking for nothing', async () => {
	test.setTimeout(180_000);
	const options = {
		allowedDiagnostics: [
			/not a git repository|gitfile does not point to a valid repository|io error: ENOENT|Invalid path '[^']+': No such file|current branch appears to be broken|is missing\./u,
		],
	};
	let app = await launchMalini(options);
	try {
		const { root } = app;
		let { page } = app;
		const source = await createSourceRepo(root, 'app');
		const origin = join(root, 'github', 'acme', 'app.git');
		mkdirSync(join(root, 'github', 'acme'), { recursive: true });
		await git(root, ['clone', '-q', '--bare', source, origin]);
		await git(source, ['remote', 'add', 'origin', origin]);
		await invoke(page, 'repositories.connect', { source: { kind: 'local-folder', path: source } });
		const { basePath, worktree } = await seedWorkstream(page, origin, WORKSTREAM_ID, 'Reclone');
		await openWorkstream(page, WORKSTREAM_ID);
		writeFileSync(join(worktree, 'notes.txt'), 'kept\n');

		app = await moveFoldersMaliniHolds(app, options, WORKSTREAM_ID, () =>
			renameSync(basePath, join(root, 'trashed-base')),
		);
		({ page } = app);
		await page.evaluate(`globalThis.dispatchEvent(new Event('focus'))`);

		await expect.poll(() => existsSync(join(basePath, '.git')), { timeout: 60_000 }).toBe(true);
		await expect
			.poll(
				() =>
					invoke(page, 'repositories.workstream-files', { workstreamId: WORKSTREAM_ID }).catch(
						() => null,
					),
				{ timeout: 30_000 },
			)
			.toEqual([{ path: 'notes.txt' }, { path: 'seed.txt' }]);
		expect(readFileSync(join(worktree, 'notes.txt'), 'utf8')).toBe('kept\n');
		await expect(
			invoke(page, 'repositories.checkout-health', { workstreamId: WORKSTREAM_ID }),
		).resolves.toMatchObject({ state: 'healthy', restored: 'commits-as-edits' });

		const setup = page.getByRole('list', { name: 'Workstream setup' });
		const recloned = setup.getByRole('listitem').filter({ hasText: 'Cloned app again' });
		await expect(recloned).toContainText('Your files stay. Commits are edits now', {
			timeout: 30_000,
		});
		await expect(setup.getByRole('button')).toHaveCount(0);
		await expect(page.getByText(/^Prompts wait/u)).toBeHidden();
		await expect(page.getByRole('status', { name: /^Needs you/u })).toHaveCount(0);
		await captureFlow(app, 'checkout-base-recloned');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
