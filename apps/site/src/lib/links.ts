import { asset, resolve } from '$app/paths';
import { GITHUB_URL } from './urls';

export const SITE_URL = 'https://bestboy.dev/malini';
export const SITE_DESCRIPTION =
	'Malini is a free, open source agentic development environment for builders moving fast. Run as many agents as you want. Malini handles the chores, so you only review pull requests and the gains compound.';

export const DOWNLOAD_URL =
	'https://github.com/bestboyhq/malini/releases/latest/download/malini-arm64.dmg';
export const BESTBOY_URL = 'https://bestboy.dev';

export const HOME = resolve('/').replace(/\/$/u, '');

export function docHref(path: string): string {
	return `${HOME}${path}`;
}

export type Link = Readonly<{
	title: string;
	href: string;
	line?: string;
	icon?: string;
	tag?: string;
	reload?: boolean;
	current?: boolean;
}>;

export type Menu = Readonly<{
	id: string;
	title: string;
	columns: readonly Readonly<{ label?: string; plain?: boolean; links: readonly Link[] }>[];
	strip?: Readonly<{ lead: string; text: string; link: Link }>;
}>;

export const isExternal = (link: Link): boolean => link.href.startsWith('http');

const LLMS: Link = { title: 'llms.txt', href: resolve('/llms.txt'), reload: true };
const LLMS_FULL: Link = { title: 'llms-full.txt', href: resolve('/llms-full.txt'), reload: true };
const MARKDOWN: Link = { title: 'Docs as markdown', href: `${docHref('/docs')}.md`, reload: true };

const RELEASES: Link = { title: 'Releases', href: `${GITHUB_URL}/releases` };
const DECISIONS: Link = { title: 'Decisions', href: `${GITHUB_URL}/tree/main/docs/adr` };
const ISSUES: Link = { title: 'Issues', href: `${GITHUB_URL}/issues` };

export const APPS: Menu = {
	id: 'apps',
	title: 'Malini',
	columns: [
		{
			links: [
				{
					title: 'Tony',
					tag: 'Say it',
					href: `${BESTBOY_URL}/tony`,
					icon: asset('/icons/tony.webp'),
					line: 'Speak to your agents.',
				},
				{
					title: 'Malini',
					tag: 'Build it',
					href: HOME,
					icon: asset('/icons/malini.webp'),
					line: 'Ship and automate them.',
					current: true,
				},
				{
					title: 'Grip',
					tag: 'Share it',
					href: `${BESTBOY_URL}/grip`,
					icon: asset('/icons/grip.webp'),
					line: 'Showcase the results.',
				},
			],
		},
	],
	strip: {
		lead: 'The suite',
		text: 'Use one, or all three together',
		link: { title: 'How they fit', href: `${BESTBOY_URL}/#turn` },
	},
};

export const MENUS: readonly Menu[] = [
	{
		id: 'product',
		title: 'Product',
		columns: [
			{
				label: 'Build',
				links: [
					{ title: 'Chats', href: `${HOME}#chats`, line: 'Plan across every repository' },
					{ title: 'Browser', href: `${HOME}#browser`, line: 'Tabs you and the agent share' },
					{ title: 'Experiments', href: `${HOME}#variants`, line: 'Try a few, build the winner' },
				],
			},
			{
				label: 'Review and ship',
				links: [
					{ title: 'Reports', href: `${HOME}#report`, line: 'Every turn, read in seconds' },
					{
						title: 'Before and after',
						href: `${HOME}#compare`,
						line: 'Wipe, flip, or diff what changed',
					},
					{
						title: 'Merge queue',
						href: `${HOME}#merge`,
						line: 'Fixes checks and reviews, then merges',
					},
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
						line: 'Pick a repository, nothing to set up',
					},
					{
						title: 'Agent tools',
						href: docHref('/docs/agent-tools'),
						line: 'A shared browser, secrets, and automations',
					},
					{
						title: 'Extensions',
						href: docHref('/docs/extensions'),
						line: 'MCP servers and skills for every agent',
					},
					{
						title: 'Events',
						href: docHref('/docs/reference/events'),
						line: 'Every event an automation can start on',
					},
				],
			},
			{
				label: 'For agents',
				links: [
					{ ...LLMS, line: 'Every docs page, as markdown' },
					{ ...LLMS_FULL, line: 'All the docs in one file, for agents' },
					{ ...MARKDOWN, line: 'Add .md to any docs page' },
				],
			},
			{ label: 'Project', plain: true, links: [RELEASES, DECISIONS, ISSUES] },
		],
	},
];

export const SITEMAP: readonly Readonly<{ label: string; links: readonly Link[] }>[] = [
	{
		label: 'Product',
		links: [
			{ title: 'Workstreams', href: docHref('/docs/workstreams') },
			{ title: 'Chat', href: docHref('/docs/chat') },
			{ title: 'Automations', href: docHref('/docs/automations') },
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
			RELEASES,
			DECISIONS,
			ISSUES,
			{ title: 'bestboy.dev', href: BESTBOY_URL },
		],
	},
];
