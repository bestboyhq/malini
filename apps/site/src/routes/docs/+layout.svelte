<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { Icon } from '@malini/hyper-ui/icons';
	import { docHref } from '$lib/links';
	import type { Snippet } from 'svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps & { children: Snippet } = $props();

	let menu: HTMLDetailsElement | undefined = $state();

	const current = $derived(
		data.sections
			.flatMap((section) => section.items)
			.find((item) => docHref(item.path) === page.url.pathname),
	);

	afterNavigate(() => {
		if (menu) menu.open = false;
	});
</script>

<div class="frame">
	<div class="rail docs">
		<aside class="side">
			<nav class="nav" aria-label="Docs" data-sveltekit-preload-code="viewport">
				{@render groups()}
			</nav>
		</aside>

		<details class="menu" bind:this={menu}>
			<summary>
				<span class="crumb">Docs</span>
				<span class="slash" aria-hidden="true">/</span>
				<span>{current?.title ?? 'Overview'}</span>
				<Icon name="chevron-down" size={14} class="chevron" />
			</summary>
			<nav aria-label="Docs pages">
				{@render groups()}
			</nav>
		</details>

		{@render children()}
	</div>
</div>

{#snippet groups()}
	{#each data.sections as section (section.title)}
		<div class="group">
			<h2>{section.title}</h2>
			<ul>
				{#each section.items as item (item.path)}
					<li>
						<a
							href={docHref(item.path)}
							aria-current={docHref(item.path) === page.url.pathname ? 'page' : undefined}
						>
							{item.title}
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{/each}
{/snippet}

<style>
	.docs {
		display: grid;
		grid-template-columns: 256px minmax(0, 1fr);
		min-height: calc(100vh - var(--header));
	}

	.side {
		border-right: 1px solid var(--line);
	}

	.nav {
		position: sticky;
		top: var(--header);
		max-height: calc(100vh - var(--header));
		overflow-y: auto;
		padding: 40px 20px;
		scrollbar-width: thin;
	}

	.group + .group {
		margin-top: 28px;
	}

	.group h2 {
		margin-bottom: 6px;
		padding: 0 10px;
		color: var(--fg);
		font-size: 13px;
		font-weight: 600;
	}

	.group ul {
		display: flex;
		flex-direction: column;
		gap: 1px;
		list-style: none;
	}

	.group a {
		display: flex;
		align-items: center;
		min-height: 32px;
		padding: 5px 10px;
		border-radius: 8px;
		color: var(--fg-muted);
		font-size: 14px;
		line-height: 20px;
		text-decoration: none;
		transition: color 150ms ease;
	}

	.group a:hover {
		color: var(--fg);
		background: var(--well);
	}

	.group a[aria-current='page'] {
		color: var(--fg);
		background: var(--well);
		font-weight: 500;
	}

	.menu {
		display: none;
	}

	@media (max-width: 860px) {
		.docs {
			grid-template-columns: minmax(0, 1fr);
		}

		.side {
			display: none;
		}

		.menu {
			display: block;
			position: sticky;
			top: var(--header);
			z-index: 10;
			border-bottom: 1px solid var(--line);
			background: var(--bg);
		}

		.menu summary {
			display: flex;
			align-items: center;
			gap: 8px;
			height: 48px;
			padding: 0 var(--pad);
			font-size: 14px;
			font-weight: 500;
			list-style: none;
			cursor: pointer;
		}

		.menu summary::-webkit-details-marker {
			display: none;
		}

		.crumb,
		.slash {
			color: var(--fg-muted);
		}

		.menu :global(.chevron) {
			margin-left: auto;
			color: var(--fg-muted);
			transition: rotate 200ms var(--ease-out-quart);
		}

		.menu[open] :global(.chevron) {
			rotate: 180deg;
		}

		.menu nav {
			max-height: calc(100vh - var(--header) - 48px);
			overflow-y: auto;
			padding: 8px calc(var(--pad) - 10px) 24px;
			border-top: 1px solid var(--line);
		}
	}
</style>
