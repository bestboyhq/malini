<script lang="ts">
	import { highlightCode, resolveLanguage } from '@malini/extension-api';
	import { SvelteSet } from 'svelte/reactivity';
	import Sensitive from '../sensitive/Sensitive.svelte';
	import { sensitiveSegmentsAcross } from '../sensitive/sensitive-segments';

	interface Props {
		code: string;
		language?: string | null;
	}

	let { code, language = null }: Props = $props();

	const resolvedLanguage = $derived(resolveLanguage(language, code));
	const tokens = $derived(highlightCode(code, resolvedLanguage));
	const pieces = $derived(sensitiveSegmentsAcross(tokens.map((token) => token.text)));
	const revealed = new SvelteSet<number>();
</script>

<code class="code-tokens" data-code-language={resolvedLanguage}>
	{#each tokens as token, index}<span class="tok-{token.kind}">
			{#each pieces[index] ?? [] as piece}{#if piece.kind}<Sensitive
						kind={piece.kind}
						revealed={revealed.has(piece.match)}
						onreveal={() => revealed.add(piece.match)}
					>
						{piece.text}
					</Sensitive>{:else}{piece.text}{/if}{/each}
		</span>{/each}
</code>
