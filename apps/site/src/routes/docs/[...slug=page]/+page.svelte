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
				<Icon name="note" size={13} />
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
		grid-template-columns: minmax(0, 1fr) 232px;
		min-width: 0;
	}

	.article {
		width: 100%;
		max-width: 760px;
		min-width: 0;
		padding: 48px 56px 72px;
	}

	.section {
		color: var(--fg-muted);
		font-size: 13px;
		font-weight: 500;
	}

	h1 {
		margin-top: 10px;
		color: var(--fg);
		font-size: clamp(30px, 3.6vw, 40px);
		font-weight: 600;
		line-height: 1.1;
		letter-spacing: -0.03em;
		text-wrap: balance;
	}

	.description {
		margin-top: 14px;
		color: var(--fg-secondary);
		font-size: 17px;
		line-height: 1.55;
		text-wrap: pretty;
	}

	.markdown {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		margin-top: 20px;
		padding: 0 10px;
		border-radius: 999px;
		box-shadow: inset 0 0 0 1px var(--line-strong);
		color: var(--fg-secondary);
		font-size: 12px;
		font-weight: 500;
		text-decoration: none;
		transition: color 150ms ease;
	}

	.markdown:hover {
		color: var(--fg);
		background: var(--well);
	}

	.prose {
		margin-top: 40px;
		padding-top: 8px;
		border-top: 1px solid var(--line);
		color: var(--fg-prose);
		font-size: 15.5px;
		line-height: 1.7;
	}

	.prose :global(h2) {
		margin: 48px 0 0;
		color: var(--fg);
		font-size: 22px;
		font-weight: 600;
		line-height: 1.3;
		letter-spacing: -0.02em;
	}

	.prose :global(h3) {
		margin: 32px 0 0;
		color: var(--fg);
		font-size: 17px;
		font-weight: 600;
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
		transition: opacity 150ms ease;
	}

	.prose :global(h2:hover .anchor::before),
	.prose :global(h3:hover .anchor::before),
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
		color: var(--fg);
		font-weight: 500;
		text-decoration: underline;
		text-decoration-color: var(--line-strong);
		text-decoration-thickness: 1px;
		text-underline-offset: 3px;
		transition: text-decoration-color 150ms ease;
	}

	.prose :global(a:not(.anchor):hover) {
		text-decoration-color: currentColor;
	}

	.prose :global(strong) {
		color: var(--fg);
		font-weight: 600;
	}

	.prose :global(code) {
		font-family: var(--mono);
		font-size: 0.86em;
	}

	.prose :global(:not(pre) > code) {
		padding: 2px 5px;
		border-radius: 5px;
		background: var(--well);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--fg);
		box-decoration-break: clone;
		-webkit-box-decoration-break: clone;
	}

	.prose :global(h2 code),
	.prose :global(h3 code) {
		padding: 0;
		background: none;
		box-shadow: none;
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
		background: var(--well);
		box-shadow: inset 0 0 0 1px var(--line);
		font-size: 13.5px;
		line-height: 1.65;
		tab-size: 2;
	}

	.prose :global(.code span) {
		color: var(--shiki-light);
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
		border-bottom: 1px solid var(--line);
		text-align: left;
		vertical-align: top;
	}

	.prose :global(th) {
		color: var(--fg);
		font-weight: 600;
		border-bottom-color: var(--line-strong);
	}

	.prose :global(blockquote) {
		padding: 2px 0 2px 16px;
		border-left: 2px solid var(--line-strong);
		color: var(--fg-secondary);
	}

	.prose :global(hr) {
		margin: 40px 0;
		border: 0;
		border-top: 1px solid var(--line);
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
		box-shadow: inset 0 0 0 1px var(--line);
		text-decoration: none;
		transition: box-shadow 150ms ease;
	}

	.pager a:hover {
		background: var(--well);
		box-shadow: inset 0 0 0 1px var(--line-strong);
	}

	.pager span {
		color: var(--fg-muted);
		font-size: 12px;
	}

	.pager strong {
		color: var(--fg);
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
		top: var(--header);
		max-height: calc(100vh - var(--header));
		overflow-y: auto;
		padding: 48px 20px;
	}

	.toc h2 {
		margin-bottom: 8px;
		color: var(--fg);
		font-size: 13px;
		font-weight: 600;
	}

	.toc ul {
		list-style: none;
		border-left: 1px solid var(--line);
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
		transition:
			color 150ms ease,
			border-color 150ms ease;
	}

	.toc a:hover {
		color: var(--fg);
	}

	.toc a.active {
		border-left-color: var(--fg);
		color: var(--fg);
	}

	@media (prefers-color-scheme: dark) {
		.prose :global(.code span) {
			color: var(--shiki-dark);
		}
	}

	@media (max-width: 1180px) {
		.page {
			grid-template-columns: minmax(0, 1fr);
		}

		.toc {
			display: none;
		}
	}

	@media (max-width: 1023px) {
		.article {
			padding: 40px var(--pad) 64px;
		}
	}
</style>
