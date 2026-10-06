<script lang="ts">
	import { detectLanguage, highlightCode, normalizeLanguage } from '@malini/extension-api';
	import { Sensitive, sensitiveSegmentsAcross } from '$hyper-ui/components/sensitive';
	import { SvelteSet } from 'svelte/reactivity';

	interface Props {
		code: string;
		language?: string | null;
	}

	let { code, language = null }: Props = $props();

	const resolvedLanguage = $derived(normalizeLanguage(language) ?? detectLanguage(code));
	const tokens = $derived(highlightCode(code, resolvedLanguage));
	const pieces = $derived(sensitiveSegmentsAcross(tokens.map((token) => token.text)));
	const revealed = new SvelteSet<number>();
</script>

<code class="code-tokens" data-code-language={resolvedLanguage ?? undefined}>
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
