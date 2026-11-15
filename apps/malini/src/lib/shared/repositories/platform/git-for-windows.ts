import { net } from 'electron';
import { REPOSITORIES_GIT_INSTALL_PROGRESS_CHANNEL } from '$contract/events';
import type { MainContext } from '$main/context';
import type { Fetch } from '$main/fs/download';
import { holdGitUntil } from '$main/git/run';
import { gitForWindowsNeeds, resolveToolPath } from '$main/process/environment';
import { gitVendor, installGit, pruneGitHomes } from '$main/process/git-install';

const WINDOWS = process.platform === 'win32';

export function registerGitForWindows(
	{ commands, events, appDataRoot }: Pick<MainContext, 'commands' | 'events' | 'appDataRoot'>,
	download: Fetch = (url, init) => net.fetch(url, init),
): void {
	const vendor = gitVendor(appDataRoot);
	let install: Promise<void> | null = null;
	const installOnce = (): Promise<void> => {
		if (install) return install;
		install = installGit(vendor, download, {
			onProgress: (progress) => events.emit(REPOSITORIES_GIT_INSTALL_PROGRESS_CHANNEL, progress),
		}).finally(() => {
			install = null;
		});
		if (resolveToolPath('git') === null) holdGitUntil(install);
		return install;
	};
	if (WINDOWS) void pruneGitHomes(vendor);
	let atLaunch = WINDOWS && gitForWindowsNeeds(vendor) !== 'nothing' ? installOnce() : null;
	atLaunch?.catch(() => {});
	commands.define('repositories.git-setup-status', () =>
		WINDOWS && gitForWindowsNeeds(vendor) === 'install' ? 'missing' : 'ready',
	);
	commands.define('repositories.install-git', () => {
		const attempt = atLaunch ?? installOnce();
		atLaunch = null;
		return attempt;
	});
}
