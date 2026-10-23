<script lang="ts">
	import { SENSITIVE_REVEAL_LABEL, maskSensitive, type SensitiveKind } from './sensitive-segments';

	interface Props {
		kind: SensitiveKind;
		text: string;
		masked?: string;
		revealed?: boolean;
		onreveal?: () => void;
		interactive?: boolean;
	}

	let { kind, text, masked, revealed, onreveal, interactive = true }: Props = $props();
	let revealedHere = $state(false);
	const shown = $derived(revealed ?? revealedHere);
	const mask = $derived(masked ?? maskSensitive(text, kind));

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

{#if shown}{text}{:else if !interactive}<span class="hyper-sensitive-mask" data-sensitive={kind}>
		{mask}
	</span>{:else}<span
		class="hyper-sensitive"
		data-sensitive={kind}
		role="button"
		tabindex="0"
		aria-label={SENSITIVE_REVEAL_LABEL[kind]}
		onclick={reveal}
		onkeydown={revealFromKeyboard}
	>
		<span class="hyper-sensitive-mask">{mask}</span>
	</span>{/if}
