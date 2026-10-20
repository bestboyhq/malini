<script lang="ts">
	import { highlightedCodeHtml, revealSensitiveCode } from './code-html';

	interface Props {
		code: string;
		language?: string | null;
	}

	let { code, language = null }: Props = $props();

	const html = $derived(highlightedCodeHtml(code, language));
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<code class="code-tokens" onclick={revealSensitiveCode} onkeydown={revealSensitiveCode}>
	{@html html}
</code>
