import { asset, resolve } from '$app/paths';

export const SITE_URL = 'https://bestboy.dev/malini';
export const SITE_DESCRIPTION =
	'Malini is a free, open source agentic development environment for builders moving fast. Run as many agents as you want. Malini handles the chores, so you only review pull requests and the gains compound.';

export const DOWNLOAD_URL =
	'https://github.com/bestboyhq/malini/releases/latest/download/malini-arm64.dmg';
export const GITHUB_URL = 'https://github.com/bestboyhq/malini';
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
}>;

export type Menu = Readonly<{
	id: string;
	title: string;
	columns: readonly Readonly<{ label: string; plain?: boolean; links: readonly Link[] }>[];
	strip?: Readonly<{ lead: string; text: string; link: Link }>;
}>;

export const isExternal = (link: Link): boolean => link.href.startsWith('http');

const LLMS: Link = { title: 'llms.txt', href: resolve('/llms.txt'), reload: true };
const LLMS_FULL: Link = { title: 'llms-full.txt', href: resolve('/llms-full.txt'), reload: true };
const MARKDOWN: Link = { title: 'Docs as markdown', href: `${docHref('/docs')}.md`, reload: true };

const BESTBOY_GITHUB = 'https://github.com/bestboyhq';

export const MENUS: readonly Menu[] = [
	{
		id: 'product',
		title: 'Product',
		columns: [
			{
				label: 'Apps',
				links: [
					{
						title: 'Tony',
						tag: 'Say it',
						href: `${BESTBOY_GITHUB}/tony/releases/latest`,
						icon: asset('/icons/tony.webp'),
						line: 'Hold a key. Speak. Let go.',
					},
					{
						title: 'Malini',
						tag: 'Build it',
						href: HOME,
						icon: asset('/icons/malini.webp'),
						line: 'Run many agents. Come back to merged pull requests.',
					},
					{
						title: 'Grip',
						tag: 'Share it',
						href: `${BESTBOY_GITHUB}/grip/releases/latest`,
						icon: asset('/icons/grip.webp'),
						line: 'Record your screen. Get a video worth watching.',
					},
				],
			},
			{
				label: 'More',
				plain: true,
				links: [
					{ title: 'How they fit together', href: `${BESTBOY_URL}/#turn` },
					{ title: 'Questions', href: `${BESTBOY_URL}/#faq` },
				],
			},
		],
		strip: {
			lead: 'The suite',
			text: 'Use one, or all three together',
			link: { title: 'Download', href: `${BESTBOY_URL}/#top` },
		},
	},
	{
		id: 'resources',
		title: 'Resources',
		columns: [
			{
				label: 'Docs',
				links: [
					{
						title: 'Malini docs',
						href: docHref('/docs'),
						line: 'Install, workstreams, jobs, and extensions',
					},
					{
						title: 'Tony on GitHub',
						href: `${BESTBOY_GITHUB}/tony#readme`,
						line: 'Install it and use it, in its README',
					},
					{
						title: 'Grip on GitHub',
						href: `${BESTBOY_GITHUB}/grip#readme`,
						line: 'Capture, edit, and share, in its README',
					},
				],
			},
			{
				label: 'For agents',
				links: [
					{
						title: 'llms.txt',
						href: `${BESTBOY_URL}/llms.txt`,
						line: "Every app's docs, as markdown for agents",
					},
					{
						title: 'Malini in one file',
						href: LLMS_FULL.href,
						reload: true,
						line: "All its docs at once, for an agent's context",
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
