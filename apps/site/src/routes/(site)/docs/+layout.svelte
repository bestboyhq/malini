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

<div class="docs">
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
		width: 100%;
		max-width: var(--col);
		min-height: calc(100dvh - var(--bar-h));
		margin: 0 auto;
	}

	.side {
		border-right: 1px solid var(--frame);
	}

	.nav {
		position: sticky;
		top: var(--bar-h);
		max-height: calc(100dvh - var(--bar-h));
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
		color: var(--fg-default);
		font-size: 13px;
		font-weight: 600;
		line-height: 20px;
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
		padding: 6px 10px;
		border-radius: 8px;
		color: var(--fg-muted);
		font-size: 14px;
		line-height: 20px;
		text-decoration: none;
	}

	.group a:active,
	.group a[aria-current='page'] {
		background: var(--surface-hover);
		color: var(--fg-default);
	}

	@media (hover: hover) and (pointer: fine) {
		.group a:hover {
			background: var(--surface-hover);
			color: var(--fg-default);
		}
	}

	.menu {
		display: none;
	}

	@media (max-width: 859px) {
		.docs {
			grid-template-columns: minmax(0, 1fr);
		}

		.side {
			display: none;
		}

		.menu {
			position: sticky;
			top: var(--bar-h);
			z-index: 10;
			display: block;
			border-bottom: 1px solid var(--frame);
			background: var(--surface-root);
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
			transition: rotate 200ms var(--ease);
		}

		.menu[open] :global(.chevron) {
			rotate: 180deg;
		}

		.menu nav {
			max-height: calc(100dvh - var(--bar-h) - 48px);
			overflow-y: auto;
			padding: 8px calc(var(--pad) - 10px) 24px;
			border-top: 1px solid var(--frame);
		}
	}
</style>
