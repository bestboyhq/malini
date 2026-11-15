import { existsSync, lstatSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { environmentVariable, findExecutable } from '../../src/main/process/command';
import { gitHome, gitVendor } from '../../src/main/process/git-install';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	expectPicker,
	launchMalini,
	openWorkstream,
	REAL_GIT,
	seedWorkstream,
	sendPrompt,
	temporaryRoot,
} from './harness';

test.skip(process.platform !== 'win32', 'Malini installs Git for Windows only on Windows');

const DOWNLOAD_FAILED = 'Could not download Git for Windows: net::ERR_NAME_NOT_RESOLVED';
const ARCH_FOLDERS = ['ucrt64', 'mingw64', 'mingw32'];
const HIDDEN = new Set([
	'PROGRAMFILES',
	'PROGRAMW6432',
	'PROGRAMFILES(X86)',
	'LOCALAPPDATA',
	'CLAUDE_CODE_GIT_BASH_PATH',
]);

function systemGit(): { root: string; arch: string } {
	for (const root of [dirname(dirname(REAL_GIT)), dirname(dirname(dirname(REAL_GIT)))]) {
		const arch = ARCH_FOLDERS.find((folder) => existsSync(join(root, folder, 'bin', 'git.exe')));
		if (arch !== undefined && existsSync(join(root, 'bin', 'bash.exe'))) {
			return { root, arch: join(root, arch) };
		}
	}
	throw new Error(`${REAL_GIT} is not part of a Git for Windows`);
}

function pcWithoutGit(root: string, laterGit: string): Record<string, string> {
	const nowhere = join(root, 'nowhere');
	const path = (environmentVariable(process.env, 'PATH') ?? '')
		.split(delimiter)
		.filter((folder) => folder !== '' && findExecutable('git', folder) === null);
	const env: Record<string, string> = {};
	for (const name of Object.keys(process.env)) {
		const upper = name.toUpperCase();
		if (upper === 'PATH') env[name] = [join(root, 'bin'), ...path, laterGit].join(delimiter);
		else if (HIDDEN.has(upper)) env[name] = nowhere;
	}
	return env;
}

function link(target: string, path: string): void {
	mkdirSync(dirname(path), { recursive: true });
	symlinkSync(target, path, 'junction');
}

function unlink(path: string): void {
	if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(path);
}

test('a PC without Git for Windows installs it at launch, holds the first prompt until it is in, and says why the install failed', async () => {
	test.setTimeout(240_000);
	const root = temporaryRoot();
	const minGit = join(root, 'mingit');
	const app = await launchMalini({
		profile: root,
		env: pcWithoutGit(root, join(minGit, 'bin')),
		allowedDiagnostics: [/repositories\.install-git GitInstallError/u],
	});
	const userData = await app.electronApp.evaluate(({ app: electron }) =>
		electron.getPath('userData'),
	);
	const home = gitHome(gitVendor(userData));
	try {
		const { page } = app;
		await expectPicker(page);
		const status = page.getByTestId('git-install-status');
		await expect(status).toHaveRole('alert', { timeout: 30_000 });
		await expect(status).toContainText(DOWNLOAD_FAILED);
		await captureFlow(app, 'first-run-git-install-failed');

		const launched = await app.electronApp.evaluate(() => ({
			path: process.env['PATH'] ?? '',
			bash: process.env['CLAUDE_CODE_GIT_BASH_PATH'] ?? '',
		}));
		expect(launched.bash).toBe(join(home, 'bin', 'bash.exe'));
		expect(launched.path.split(delimiter)).toContain(join(home, 'cmd'));
		expect(findExecutable('git', launched.path)).toBeNull();

		await status.getByRole('button', { name: 'Try again' }).click();
		await expect(status).toHaveRole('alert', { timeout: 30_000 });
		await expect(status).toContainText(DOWNLOAD_FAILED);

		const git = systemGit();
		link(git.arch, minGit);
		const source = await createSourceRepo(root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-git-held-ws', 'Held for Git');
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'SEARCH the fixture repo');
		const strip = page.getByTestId('provider-connect-strip');
		await expect(strip).toHaveAttribute('data-access', 'git-missing');
		await expect(strip.getByRole('alert')).toHaveText(DOWNLOAD_FAILED, { timeout: 30_000 });
		await captureFlow(app, 'composer-git-install-failed');

		link(git.root, home);
		unlink(minGit);
		await strip.getByRole('button', { name: 'Try again' }).click();
		await expectAssistantReply(page);
		await expect(strip).toHaveCount(0);

		const vendored = await createSourceRepo(root, 'vendored');
		const { worktree } = await seedWorkstream(
			page,
			vendored,
			'e2e-git-vendored-ws',
			'Vendored Git',
		);
		expect(existsSync(join(worktree, 'seed.txt'))).toBe(true);
		expect(findExecutable('git', launched.path)).toBe(join(home, 'cmd', 'git.exe'));
		expectCleanConsole(app);
	} finally {
		unlink(minGit);
		unlink(home);
		await app.close();
	}
});
