<script lang="ts">
	import type { Snippet } from 'svelte';
	import { SENSITIVE_REVEAL_LABEL, type SensitiveKind } from './sensitive-segments';

	interface Props {
		kind: SensitiveKind;
		revealed?: boolean;
		onreveal?: () => void;
		interactive?: boolean;
		children: Snippet;
	}

	let { kind, revealed, onreveal, interactive = true, children }: Props = $props();
	let revealedHere = $state(false);
	const shown = $derived(revealed ?? revealedHere);

	function reveal(event: Event): void {
		event.preventDefault();
		event.stopPropagation();
		revealedHere = true;
		onreveal?.();
	}

	function revealFromKeyboard(event: KeyboardEvent): void {
		if (event.key === 'Enter' || event.key === ' ') reveal(event);
	}
</script>

{#if shown}{@render children()}{:else if !interactive}<span
		class="hyper-sensitive-mask inline-block"
		data-sensitive={kind}
	>
		{@render children()}
	</span>{:else}<span
		class="hyper-sensitive"
		data-sensitive={kind}
		role="button"
		tabindex="0"
		aria-label={SENSITIVE_REVEAL_LABEL[kind]}
		onclick={reveal}
		onkeydown={revealFromKeyboard}
	>
		<span class="hyper-sensitive-mask">{@render children()}</span>
	</span>{/if}
