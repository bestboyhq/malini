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

export type Link = Readonly<{ title: string; href: string; line?: string; reload?: boolean }>;

export type Menu = Readonly<{
	id: string;
	title: string;
	columns: readonly Readonly<{ label: string; plain?: boolean; links: readonly Link[] }>[];
}>;

export const isExternal = (link: Link): boolean => link.href.startsWith('http');

const LLMS: Link = { title: 'llms.txt', href: resolve('/llms.txt'), reload: true };
const LLMS_FULL: Link = { title: 'llms-full.txt', href: resolve('/llms-full.txt'), reload: true };
const MARKDOWN: Link = { title: 'Docs as markdown', href: `${docHref('/docs')}.md`, reload: true };

export const MENUS: readonly Menu[] = [
	{
		id: 'product',
		title: 'Product',
		columns: [
			{
				label: 'Features',
				links: [
					{
						title: 'Workstreams',
						href: docHref('/docs/workstreams'),
						line: 'A worktree, a branch, and chats per task',
					},
					{
						title: 'Chat',
						href: docHref('/docs/chat'),
						line: 'Queue or steer prompts, plan, undo, fork',
					},
					{
						title: 'Jobs',
						href: docHref('/docs/jobs'),
						line: 'Agent work you reuse by name',
					},
					{
						title: 'Routines',
						href: docHref('/docs/routines'),
						line: 'Jobs that run when something happens',
					},
				],
			},
			{
				label: 'More from Bestboy',
				plain: true,
				links: [
					{ title: 'Tony', href: 'https://github.com/bestboyhq/tony/releases/latest' },
					{ title: 'Grip', href: 'https://github.com/bestboyhq/grip/releases/latest' },
				],
			},
		],
	},
	{
		id: 'resources',
		title: 'Resources',
		columns: [
			{
				label: 'Docs',
				links: [
					{
						title: 'Install',
						href: docHref('/docs/install'),
						line: 'Download, connect, add a repository',
					},
					{
						title: 'Agent tools',
						href: docHref('/docs/agent-tools'),
						line: 'A shared browser, jobs, routines, events',
					},
					{
						title: 'Extensions',
						href: docHref('/docs/extensions'),
						line: 'Panels, commands, settings, workflows',
					},
					{
						title: 'Events',
						href: docHref('/docs/reference/events'),
						line: 'Every event and its payload',
					},
				],
			},
			{
				label: 'For agents',
				links: [
					{ ...LLMS, line: 'Every docs page, listed for agents' },
					{ ...LLMS_FULL, line: 'All the docs in one file' },
					{ ...MARKDOWN, line: 'Any page as plain markdown' },
				],
			},
			{
				label: 'Project',
				links: [
					{
						title: 'Releases',
						href: `${GITHUB_URL}/releases`,
						line: 'Every version and its notes',
					},
					{
						title: 'Decisions',
						href: `${GITHUB_URL}/tree/main/docs/adr`,
						line: 'Why Malini is built this way',
					},
					{
						title: 'Issues',
						href: `${GITHUB_URL}/issues`,
						line: 'Report a bug or ask for a feature',
					},
				],
			},
		],
	},
];

export const SITEMAP: readonly Readonly<{ label: string; links: readonly Link[] }>[] = [
	{
		label: 'Product',
		links: [
			{ title: 'Workstreams', href: docHref('/docs/workstreams') },
			{ title: 'Chat', href: docHref('/docs/chat') },
			{ title: 'Jobs', href: docHref('/docs/jobs') },
			{ title: 'Routines', href: docHref('/docs/routines') },
			{ title: 'Download', href: DOWNLOAD_URL },
		],
	},
	{
		label: 'Docs',
		links: [
			{ title: 'Install', href: docHref('/docs/install') },
			{ title: 'Agent tools', href: docHref('/docs/agent-tools') },
			{ title: 'Extensions', href: docHref('/docs/extensions') },
			{ title: 'Events', href: docHref('/docs/reference/events') },
		],
	},
	{
		label: 'For agents',
		links: [
			LLMS,
			LLMS_FULL,
			MARKDOWN,
			{ title: 'Sitemap', href: resolve('/sitemap.xml'), reload: true },
		],
	},
	{
		label: 'Project',
		links: [
			{ title: 'Source code', href: GITHUB_URL },
			{ title: 'Releases', href: `${GITHUB_URL}/releases` },
			{ title: 'Decisions', href: `${GITHUB_URL}/tree/main/docs/adr` },
			{ title: 'Issues', href: `${GITHUB_URL}/issues` },
			{ title: 'bestboy.dev', href: BESTBOY_URL },
		],
	},
];
