<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { Icon } from '@malini/hyper-ui/icons';
	import Head from '$lib/Head.svelte';
	import { docHref, SITE_URL } from '$lib/links';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const page = $derived(data.page);

	let heading: HTMLHeadingElement | undefined = $state();
	let article: HTMLElement | undefined = $state();
	let active = $state('');

	afterNavigate(({ type }) => {
		if (type !== 'enter' && !location.hash) heading?.focus({ preventScroll: true });
	});

	$effect(() => {
		const ids = new Set(page.headings.map((entry) => entry.id));
		const targets = [...(article?.querySelectorAll('h2[id]') ?? [])].filter((node) =>
			ids.has(node.id),
		);
		active = '';
		if (targets.length === 0) return;
		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries.filter((entry) => entry.isIntersecting);
				const top = visible.sort(
					(left, right) => left.boundingClientRect.top - right.boundingClientRect.top,
				)[0];
				if (top) active = top.target.id;
			},
			{ rootMargin: '-80px 0px -66% 0px' },
		);
		for (const target of targets) observer.observe(target);
		return () => observer.disconnect();
	});
</script>

<Head
	title={page.slug ? `${page.title} - Malini docs` : 'Malini docs'}
	description={page.description}
	path={page.path}
/>

<svelte:head>
	<link rel="alternate" type="text/markdown" href="{SITE_URL}{page.path}.md" />
</svelte:head>

<div class="page">
	<article class="article" bind:this={article}>
		<header class="intro">
			<p class="section">{page.section}</p>
			<h1 tabindex="-1" bind:this={heading}>{page.title}</h1>
			{#if page.description}
				<p class="description">{page.description}</p>
			{/if}
			<a class="markdown" href="{docHref(page.path)}.md" data-sveltekit-reload>
				<Icon name="note" size={14} />
				Open as markdown
			</a>
		</header>
		<div class="prose">
			{@html page.html}
		</div>
		<nav class="pager" aria-label="Previous and next page">
			{#if data.previous}
				<a class="previous" href={docHref(data.previous.path)}>
					<span>Previous</span>
					<strong>{data.previous.title}</strong>
				</a>
			{/if}
			{#if data.next}
				<a class="next" href={docHref(data.next.path)}>
					<span>Next</span>
					<strong>{data.next.title}</strong>
				</a>
			{/if}
		</nav>
	</article>

	{#if page.headings.length > 1}
		<aside class="toc">
			<nav aria-label="On this page">
				<h2>On this page</h2>
				<ul>
					{#each page.headings as entry (entry.id)}
						<li>
							<a href="#{entry.id}" class:active={active === entry.id}>{entry.text}</a>
						</li>
					{/each}
				</ul>
			</nav>
		</aside>
	{/if}
</div>

<style>
	.page {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 180px;
		min-width: 0;
	}

	.article {
		width: 100%;
		max-width: calc(640px + 2 * 56px);
		min-width: 0;
		padding: 48px 56px 80px;
	}

	.section {
		color: var(--fg-muted);
		font-size: 14px;
		line-height: 20px;
	}

	h1 {
		margin-top: 12px;
		color: var(--fg-default);
		font-size: clamp(30px, 3.4vw, 40px);
		font-weight: 550;
		line-height: 1.1;
		letter-spacing: -0.03em;
		text-wrap: balance;
	}

	.description {
		margin-top: 20px;
		color: var(--fg-muted);
		font-size: 19px;
		line-height: 1.55;
		text-wrap: pretty;
	}

	.markdown {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 30px;
		margin-top: 24px;
		padding: 0 12px;
		border-radius: 999px;
		box-shadow: inset 0 0 0 1px var(--border-subtle);
		color: var(--fg-secondary);
		font-size: 13px;
		font-weight: 500;
		text-decoration: none;
	}

	.markdown:active {
		color: var(--fg-default);
	}

	.prose {
		margin-top: 40px;
		padding-top: 8px;
		border-top: 1px solid var(--border-default);
		color: var(--fg-prose);
		font-size: 16px;
		line-height: 1.7;
	}

	.prose :global(h2) {
		margin: 48px 0 0;
		color: var(--fg-default);
		font-size: 22px;
		font-weight: 550;
		line-height: 28px;
		letter-spacing: -0.02em;
		text-wrap: balance;
	}

	.prose :global(h3) {
		margin: 32px 0 0;
		color: var(--fg-default);
		font-size: 17px;
		font-weight: 550;
		line-height: 1.6;
		letter-spacing: -0.01em;
	}

	.prose :global(.anchor) {
		position: relative;
		color: inherit;
		text-decoration: none;
	}

	.prose :global(.anchor::before) {
		content: '#';
		position: absolute;
		left: -0.9em;
		color: var(--fg-faint);
		font-weight: 400;
		opacity: 0;
	}

	.prose :global(.anchor:focus-visible::before) {
		opacity: 1;
	}

	.prose :global(p),
	.prose :global(ul),
	.prose :global(ol),
	.prose :global(.code),
	.prose :global(table),
	.prose :global(blockquote) {
		margin: 16px 0 0;
	}

	.prose :global(ul),
	.prose :global(ol) {
		padding-left: 22px;
	}

	.prose :global(li + li) {
		margin-top: 6px;
	}

	.prose :global(li::marker) {
		color: var(--fg-faint);
	}

	.prose :global(a:not(.anchor)) {
		color: var(--fg-default);
		font-weight: 500;
		text-decoration: underline;
		text-decoration-color: var(--border-strong);
		text-decoration-thickness: 1.5px;
		text-underline-offset: 3px;
	}

	.prose :global(a:not(.anchor):active) {
		text-decoration-color: var(--fg-default);
	}

	.prose :global(strong) {
		color: var(--fg-default);
		font-weight: 600;
	}

	.prose :global(code) {
		font-family: var(--mono);
		font-size: 13.5px;
	}

	.prose :global(:not(pre) > code) {
		padding: 2px 6px;
		border-radius: 6px;
		background: var(--surface-well);
		color: var(--fg-default);
		box-decoration-break: clone;
	}

	.prose :global(h2 code),
	.prose :global(h3 code) {
		padding: 0;
		background: none;
		font-size: 0.88em;
	}

	.prose :global(td code) {
		white-space: nowrap;
	}

	.prose :global(.code pre) {
		margin: 0;
		padding: 16px 18px;
		overflow-x: auto;
		border-radius: 10px;
		background: var(--surface-well);
		box-shadow: inset 0 0 0 1px var(--border-subtle);
		line-height: 1.65;
		tab-size: 2;
	}

	.prose :global(.code span) {
		color: light-dark(var(--shiki-light), var(--shiki-dark));
	}

	.prose :global(table) {
		display: block;
		width: 100%;
		overflow-x: auto;
		border-collapse: collapse;
		font-size: 14px;
		line-height: 1.55;
	}

	.prose :global(th),
	.prose :global(td) {
		padding: 10px 16px 10px 0;
		border-bottom: 1px solid var(--border-subtle);
		text-align: left;
		vertical-align: top;
	}

	.prose :global(th) {
		border-bottom-color: var(--border-default);
		color: var(--fg-default);
		font-weight: 600;
	}

	.prose :global(blockquote) {
		padding: 2px 0 2px 16px;
		border-left: 2px solid var(--border-default);
		color: var(--fg-secondary);
	}

	.prose :global(hr) {
		margin: 40px 0;
		border: 0;
		border-top: 1px solid var(--border-default);
	}

	.pager {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
		margin-top: 64px;
	}

	.pager a {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 14px 16px;
		border-radius: 12px;
		box-shadow: inset 0 0 0 1px var(--border-subtle);
		text-decoration: none;
	}

	.pager a:active {
		background: var(--surface-hover);
	}

	.pager span {
		color: var(--fg-faint);
		font-family: var(--mono);
		font-size: 12px;
		line-height: 16px;
	}

	.pager strong {
		color: var(--fg-default);
		font-size: 15px;
		font-weight: 550;
	}

	.next {
		grid-column: 2;
		align-items: flex-end;
		text-align: right;
	}

	.toc nav {
		position: sticky;
		top: var(--bar-h);
		max-height: calc(100dvh - var(--bar-h));
		overflow-y: auto;
		padding: 48px 20px 48px 0;
	}

	.toc h2 {
		margin-bottom: 8px;
		color: var(--fg-default);
		font-size: 13px;
		font-weight: 600;
		line-height: 20px;
	}

	.toc ul {
		border-left: 1px solid var(--border-default);
		list-style: none;
	}

	.toc a {
		display: block;
		margin-left: -1px;
		padding: 4px 0 4px 12px;
		border-left: 1px solid transparent;
		color: var(--fg-muted);
		font-size: 13px;
		line-height: 1.45;
		text-decoration: none;
		overflow-wrap: anywhere;
	}

	.toc a.active {
		border-left-color: var(--brand);
		color: var(--fg-default);
	}

	@media (hover: hover) and (pointer: fine) {
		.markdown:hover,
		.toc a:hover {
			color: var(--fg-default);
		}

		.markdown:hover {
			box-shadow: inset 0 0 0 1px var(--border-default);
		}

		.pager a:hover {
			background: var(--surface-hover);
		}

		.prose :global(h2:hover .anchor::before),
		.prose :global(h3:hover .anchor::before) {
			opacity: 1;
		}

		.prose :global(a:not(.anchor):hover) {
			text-decoration-color: var(--fg-default);
		}
	}

	@media (max-width: 1023px) {
		.page {
			grid-template-columns: minmax(0, 1fr);
		}

		.toc {
			display: none;
		}

		.article {
			padding: 40px var(--pad) 64px;
		}
	}

	@media (max-width: 859px) {
		.description {
			font-size: 17px;
		}
	}
</style>
