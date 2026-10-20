import { resolve } from '$app/paths';

export const SITE_URL = 'https://bestboy.dev/malini';
export const SITE_DESCRIPTION =
	'Malini is a free, open source Mac app that runs many Claude Code agents side by side, each in its own git worktree, and takes every one to a merged pull request.';

export const DOWNLOAD_URL = 'https://github.com/bestboyhq/malini/releases/latest';
export const GITHUB_URL = 'https://github.com/bestboyhq/malini';
export const BESTBOY_URL = 'https://bestboy.dev';

export const HOME = resolve('/').replace(/\/$/u, '');

export function docHref(path: string): string {
	return `${HOME}${path}`;
}
