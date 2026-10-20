<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import { Button } from '$hyper-ui/components/button';
	import { CodeTokens } from '$hyper-ui/components/code-tokens';
	import type { FullToolOutput } from '$lib/chat/domain/full-tool-output';

	interface Props {
		text: string;
		language?: string | null;
		class?: ClassValue;
		endClass?: ClassValue;
		fullLength?: number | null;
		fullOutput?: FullToolOutput | null;
		onloadfull?: (() => void) | undefined;
	}

	let {
		text,
		language = null,
		class: className,
		endClass,
		fullLength = null,
		fullOutput = null,
		onloadfull,
	}: Props = $props();

	const HEAD_LINES = 200;
	const TAIL_LINES = 100;
	const CAP_SLACK_LINES = 50;

	let showAll = $state(false);

	const loaded = $derived(fullOutput?.status === 'ready' ? fullOutput.output : null);
	const shown = $derived(loaded ?? text);
	const preview = $derived(loaded === null && fullLength !== null && onloadfull !== undefined);
	const lines = $derived(shown.split('\n'));
	const capped = $derived(
		!showAll && !preview && lines.length > HEAD_LINES + TAIL_LINES + CAP_SLACK_LINES,
	);
	const head = $derived(capped ? lines.slice(0, HEAD_LINES).join('\n') : shown);
	const tail = $derived(capped ? lines.slice(-TAIL_LINES).join('\n') : null);
	const fullSize = $derived(`${Math.max(1, Math.round((fullLength ?? 0) / 1024))} KB`);
</script>

<pre class={[className, !capped && !preview && endClass]}><CodeTokens
		code={head}
		{language}
	/></pre>
{#if tail !== null}
	<div class="px-2 py-1">
		<Button size="xs" variant="ghost" onclick={() => (showAll = true)}>
			Show all {lines.length} lines
		</Button>
	</div>
	<pre class={[className, endClass]}><CodeTokens code={tail} {language} /></pre>
{:else if preview}
	<div class="px-2 py-1">
		<Button
			size="xs"
			variant="ghost"
			loading={fullOutput?.status === 'loading'}
			onclick={() => onloadfull?.()}
		>
			Show full output · {fullSize}
		</Button>
	</div>
{/if}
