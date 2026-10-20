<script lang="ts">
	import '@fontsource-variable/inter/opsz.css';
	import inter from '@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2?url';
	import '../app.css';
	import { asset, resolve } from '$app/paths';
	import { page } from '$app/state';
	import { GitHubIcon, Icon } from '@malini/hyper-ui/icons';
	import { BESTBOY_URL, docHref, DOWNLOAD_URL, GITHUB_URL, HOME } from '$lib/links';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	const inDocs = $derived(page.url.pathname.startsWith(docHref('/docs')));

	const columns = [
		{
			title: 'Product',
			links: [
				{ title: 'Workstreams', href: docHref('/docs/workstreams') },
				{ title: 'Chat', href: docHref('/docs/chat') },
				{ title: 'Jobs', href: docHref('/docs/jobs') },
				{ title: 'Routines', href: docHref('/docs/routines') },
				{ title: 'Download', href: DOWNLOAD_URL, external: true },
			],
		},
		{
			title: 'Docs',
			links: [
				{ title: 'Install', href: docHref('/docs/install') },
				{ title: 'Agent tools', href: docHref('/docs/agent-tools') },
				{ title: 'Extensions', href: docHref('/docs/extensions') },
				{ title: 'Events', href: docHref('/docs/reference/events') },
			],
		},
		{
			title: 'For agents',
			links: [
				{ title: 'llms.txt', href: resolve('/llms.txt'), raw: true },
				{ title: 'llms-full.txt', href: resolve('/llms-full.txt'), raw: true },
				{ title: 'Docs as markdown', href: `${docHref('/docs')}.md`, raw: true },
				{ title: 'Sitemap', href: resolve('/sitemap.xml'), raw: true },
			],
		},
		{
			title: 'Project',
			links: [
				{ title: 'Source code', href: GITHUB_URL, external: true },
				{ title: 'Releases', href: `${GITHUB_URL}/releases`, external: true },
				{ title: 'Decisions', href: `${GITHUB_URL}/tree/main/docs/adr`, external: true },
				{ title: 'Issues', href: `${GITHUB_URL}/issues`, external: true },
				{ title: 'bestboy.dev', href: BESTBOY_URL, external: true },
			],
		},
	];
</script>

<svelte:head>
	<link rel="preload" href={inter} as="font" type="font/woff2" crossorigin="anonymous" />
</svelte:head>

<a class="skip" href="#main">Skip to content</a>

<header class="header">
	<div class="frame">
		<div class="bar">
			<div class="brand">
				<a class="org" href={BESTBOY_URL} aria-label="Bestboy" data-sveltekit-reload>
					<img src={asset('/bestboy.svg')} width="22" height="22" alt="" />
					<span class="org-name">Bestboy</span>
				</a>
				<span class="slash" aria-hidden="true">/</span>
				<a class="product" href={HOME}>
					<img src={asset('/malini.png')} width="22" height="22" alt="" />
					Malini
				</a>
			</div>
			<nav class="links" aria-label="Malini">
				<a href={docHref('/docs')} aria-current={inDocs ? 'page' : undefined}>Docs</a>
				<a class="github" href={GITHUB_URL}>
					<GitHubIcon size={15} />
					<span>GitHub</span>
				</a>
				<a class="button primary small" href={DOWNLOAD_URL}>Download</a>
			</nav>
		</div>
	</div>
</header>

<main id="main">
	{@render children()}
</main>

<footer class="footer">
	<div class="hatch"></div>
	<div class="frame">
		<div class="rail">
			<div class="grid">
				<div class="mark">
					<a class="product" href={HOME}>
						<img src={asset('/malini.png')} width="28" height="28" alt="" />
						Malini
					</a>
					<p>Many Claude Code agents, one window, one merged pull request each.</p>
				</div>
				{#each columns as column (column.title)}
					<nav aria-label={column.title}>
						<h2>{column.title}</h2>
						<ul>
							{#each column.links as link (link.title)}
								<li>
									<a href={link.href} data-sveltekit-reload={'raw' in link ? true : undefined}>
										{link.title}
										{#if 'external' in link}
											<Icon name="external-link" size={11} />
										{/if}
									</a>
								</li>
							{/each}
						</ul>
					</nav>
				{/each}
			</div>
			<div class="legal">
				<span>© 2026 Bestboy. Free and open source under AGPL-3.0.</span>
				<span>Claude and Claude Code are trademarks of Anthropic, PBC.</span>
			</div>
		</div>
	</div>
</footer>

<style>
	.header {
		position: sticky;
		top: 0;
		z-index: 20;
		border-bottom: 1px solid var(--line);
		background: color-mix(in srgb, var(--bg) 82%, transparent);
		backdrop-filter: blur(12px) saturate(1.4);
		-webkit-backdrop-filter: blur(12px) saturate(1.4);
	}

	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		height: var(--header);
		padding: 0 var(--pad);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}

	.org,
	.product {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		color: var(--fg);
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
		text-decoration: none;
	}

	.org img,
	.product img {
		border-radius: 6px;
	}

	.slash {
		color: var(--fg-faint);
	}

	.links {
		display: flex;
		align-items: center;
		gap: 24px;
	}

	.links a:not(.button) {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		color: var(--fg-secondary);
		font-size: 14px;
		font-weight: 500;
		text-decoration: none;
		transition: color 150ms ease;
	}

	.links a:not(.button):hover,
	.links a[aria-current='page'] {
		color: var(--fg);
	}

	.footer {
		margin-top: 0;
	}

	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) repeat(4, 10rem);
		gap: 48px 24px;
		padding: 72px var(--pad) 0;
	}

	.mark p {
		max-width: 240px;
		margin-top: 14px;
		color: var(--fg-muted);
		font-size: 13px;
		line-height: 1.55;
	}

	.mark img {
		border-radius: 7px;
	}

	.grid h2 {
		display: flex;
		align-items: center;
		height: 28px;
		color: var(--fg-muted);
		font-size: 13px;
		font-weight: 500;
	}

	.grid ul {
		list-style: none;
	}

	.grid li a {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		color: var(--fg-secondary);
		font-size: 14px;
		text-decoration: none;
		transition: color 150ms ease;
	}

	.grid li a:hover {
		color: var(--fg);
	}

	.grid li a :global(svg) {
		color: var(--fg-faint);
	}

	.legal {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 8px 24px;
		margin-top: 96px;
		padding: 0 var(--pad) 40px;
		color: var(--fg-muted);
		font-size: 12px;
	}

	@media (max-width: 1023px) {
		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.mark {
			grid-column: 1 / -1;
		}

		.legal {
			margin-top: 56px;
		}
	}

	.links :global(svg),
	.brand img {
		flex: none;
	}

	@media (max-width: 560px) {
		.links {
			gap: 16px;
		}

		.github span,
		.org-name {
			display: none;
		}

		.brand {
			gap: 8px;
		}
	}
</style>
