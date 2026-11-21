import { realpath } from 'node:fs/promises';
import { shell } from 'electron';
import type { CheckoutFinding } from '$contract/repositories';
import { describeError } from '$main/errors';
import { runGit, runGitAllowingExit } from '$main/git/run';
import { resolveToolPath } from '$main/process/environment';
import { boundedRunFailureReason, runBounded, type ProcessRunner } from '$main/process/runner';
import { examineCheckout, type CheckoutCase } from './checkout-doctor';

const POLL_MS = 2_000;
const INSTALL_WAIT_MS = 30 * 60_000;
const HANDOFF_WAIT_MS = 10 * 60_000;
const INSTALLER_BUDGET_MS = 30_000;
const PRIVACY_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';
const STORAGE_SETTINGS = 'x-apple.systempreferences:com.apple.settings.Storage';
const ACCEPT_LICENSE =
	'do shell script "/usr/bin/xcodebuild -license accept" with administrator privileges';
const ALREADY_INSTALLED = /already installed/iu;
const CANCELED = /\(-128\)/u;

export async function fixCheckout(finding: CheckoutFinding, c: CheckoutCase): Promise<void> {
	try {
		await fix(finding, c);
	} catch (error) {
		console.error(`malini: could not fix ${finding} in ${c.checkout}: ${describeError(error)}`);
	}
}

async function fix(finding: CheckoutFinding, c: CheckoutCase): Promise<void> {
	switch (finding) {
		case 'dubious-ownership':
			return trust([c.checkout, ...(c.repository === null ? [] : [c.repository])]);
		case 'git-unavailable':
		case 'developer-tools-missing':
			if (await openInstaller(c.runner)) await waitForCure(finding, c, INSTALL_WAIT_MS);
			return;
		case 'xcode-license':
			return acceptLicense(c.runner);
		case 'permission-denied':
			await shell.openExternal(PRIVACY_SETTINGS);
			return waitForCure(finding, c, HANDOFF_WAIT_MS);
		case 'disk-full':
			await shell.openExternal(STORAGE_SETTINGS);
			return waitForCure(finding, c, HANDOFF_WAIT_MS);
		default:
			return;
	}
}

async function trust(folders: readonly string[]): Promise<void> {
	const listed = await runGitAllowingExit(['config', '--global', '--get-all', 'safe.directory'], 1);
	const trusted = new Set(listed.stdout.split('\n'));
	const real = await Promise.all(folders.map((folder) => realpath(folder).catch(() => folder)));
	for (const folder of new Set(real)) {
		if (!trusted.has(folder))
			await runGit(['config', '--global', '--add', 'safe.directory', folder]);
	}
}

async function openInstaller(runner: ProcessRunner): Promise<boolean> {
	const xcodeSelect = resolveToolPath('xcode-select') ?? '/usr/bin/xcode-select';
	const run = await runBounded(runner, xcodeSelect, ['--install'], {
		deadline: Date.now() + INSTALLER_BUDGET_MS,
	});
	if (run.exitCode === 0) return true;
	if (!ALREADY_INSTALLED.test(`${run.stderr}${run.stdout}`)) {
		console.error(`malini: ${boundedRunFailureReason(run, 'xcode-select --install')}`);
	}
	return false;
}

async function acceptLicense(runner: ProcessRunner): Promise<void> {
	const run = await runBounded(runner, '/usr/bin/osascript', ['-e', ACCEPT_LICENSE], {
		deadline: Date.now() + HANDOFF_WAIT_MS,
	});
	if (run.exitCode === 0 || CANCELED.test(run.stderr)) return;
	console.error(`malini: ${boundedRunFailureReason(run, 'xcodebuild -license accept')}`);
}

async function waitForCure(
	finding: CheckoutFinding,
	c: CheckoutCase,
	limitMs: number,
): Promise<void> {
	const cured = await waitUntil(
		async () => (await examineCheckout(c))?.finding !== finding,
		limitMs,
	);
	if (!cured)
		console.error(`malini: ${finding} stayed in ${c.checkout} for ${limitMs / 60_000} min`);
}

export async function waitUntil(
	condition: () => Promise<boolean>,
	limitMs: number,
): Promise<boolean> {
	const deadline = Date.now() + limitMs;
	while (!(await condition())) {
		if (Date.now() >= deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
	}
	return true;
}
