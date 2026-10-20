<script lang="ts">
	import DOMPurify from 'dompurify';
	import { marked } from 'marked';
	import { highlightCodeElements } from '$hyper-ui/components/code-tokens';
	import { openExternalUrlCommand } from '../application/commands/open-external-url.command';

	interface Props {
		markdown: string;
	}
	let { markdown }: Props = $props();
	const html = $derived(highlightedHtml(markdown));

	function highlightedHtml(source: string): string {
		const template = document.createElement('template');
		template.innerHTML = DOMPurify.sanitize(marked.parse(source, { async: false }));
		highlightCodeElements(template.content);
		return template.innerHTML;
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

<article class="directory-readme text-fg-secondary text-sm leading-6" use:externalLinks>
	{@html html}
</article>

<style>
	.directory-readme :global(h1),
	.directory-readme :global(h2),
	.directory-readme :global(h3) {
		margin-top: 1.5rem;
		margin-bottom: 0.5rem;
		color: var(--color-fg-default);
		font-weight: 500;
		line-height: 1.35;
	}
	.directory-readme :global(h1) {
		font-size: 1.25rem;
	}
	.directory-readme :global(h2) {
		font-size: 1.05rem;
	}
	.directory-readme :global(h3) {
		font-size: 0.95rem;
	}
	.directory-readme :global(p),
	.directory-readme :global(ul),
	.directory-readme :global(ol),
	.directory-readme :global(pre) {
		margin: 0.6rem 0;
	}
	.directory-readme :global(ul),
	.directory-readme :global(ol) {
		padding-left: 1.4rem;
	}
	.directory-readme :global(ul) {
		list-style: disc;
	}
	.directory-readme :global(ol) {
		list-style: decimal;
	}
	.directory-readme :global(a) {
		color: var(--color-brand);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.directory-readme :global(code) {
		border-radius: 0.3rem;
		background: var(--color-surface-50);
		padding: 0.12rem 0.3rem;
		font-size: 0.85em;
	}
	.directory-readme :global(pre) {
		overflow: auto;
		border: 1px solid var(--color-border-subtle);
		border-radius: 0.75rem;
		padding: 0.8rem;
	}
	.directory-readme :global(pre code) {
		background: transparent;
		padding: 0;
	}
</style>
