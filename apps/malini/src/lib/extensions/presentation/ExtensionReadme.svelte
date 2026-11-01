<script lang="ts">
	import { highlightCodeElements } from '$hyper-ui/components/code-tokens';
	import { openExternalUrlCommand } from '../application/commands/open-external-url.command';
	import { readmeFragment } from './readme-html';

	interface Props {
		markdown: string;
		title: string;
	}
	let { markdown, title }: Props = $props();
	const html = $derived(highlightedHtml(markdown, title));

	function highlightedHtml(source: string, name: string): string {
		const fragment = readmeFragment(source, name);
		highlightCodeElements(fragment);
		const holder = document.createElement('div');
		holder.append(fragment);
		return holder.innerHTML;
	}

	function openLink(event: MouseEvent): void {
		if (!(event.target instanceof Element)) return;
		const anchor = event.target.closest('a');
		if (!(anchor instanceof HTMLAnchorElement)) return;
		event.preventDefault();
		openExternalUrlCommand(anchor.href);
	}

	function externalLinks(node: HTMLElement): { destroy: () => void } {
		node.addEventListener('click', openLink);
		return { destroy: () => node.removeEventListener('click', openLink) };
	}
</script>

<article class="extension-readme text-fg-secondary text-sm leading-6" use:externalLinks>
	{@html html}
</article>

<style>
	.extension-readme :global(h3),
	.extension-readme :global(h4),
	.extension-readme :global(h5),
	.extension-readme :global(h6) {
		margin-top: 1.25rem;
		margin-bottom: 0.5rem;
		color: var(--color-fg-default);
		font-weight: 500;
		line-height: 1.35;
	}
	.extension-readme :global(h3) {
		font-size: 1.05rem;
	}
	.extension-readme :global(h4) {
		font-size: 0.95rem;
	}
	.extension-readme :global(p),
	.extension-readme :global(ul),
	.extension-readme :global(ol),
	.extension-readme :global(pre) {
		margin: 0.6rem 0;
	}
	.extension-readme > :global(:first-child) {
		margin-top: 0;
	}
	.extension-readme > :global(:last-child) {
		margin-bottom: 0;
	}
	.extension-readme :global(ul),
	.extension-readme :global(ol) {
		padding-left: 1.4rem;
	}
	.extension-readme :global(ul) {
		list-style: disc;
	}
	.extension-readme :global(ol) {
		list-style: decimal;
	}
	.extension-readme :global(a) {
		color: var(--color-brand);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.extension-readme :global(code) {
		border-radius: 0.3rem;
		background: var(--color-surface-50);
		padding: 0.12rem 0.3rem;
		font-size: 0.85em;
	}
	.extension-readme :global(pre) {
		overflow: auto;
		border: 1px solid var(--color-border-subtle);
		border-radius: 0.75rem;
		padding: 0.8rem;
	}
	.extension-readme :global(pre code) {
		background: transparent;
		padding: 0;
	}
</style>
