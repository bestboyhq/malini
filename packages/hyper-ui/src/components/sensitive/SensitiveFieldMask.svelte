<script lang="ts">
	interface Props {
		field: HTMLInputElement | HTMLTextAreaElement | null;
		value: string;
		multiline?: boolean;
	}

	let { field, value, multiline = false }: Props = $props();
	let focused = $state(false);
	let metrics = $state('');

	const masked = $derived(
		field !== null &&
			!focused &&
			value.length > 0 &&
			!(field instanceof HTMLInputElement && field.type === 'password'),
	);

	$effect(() => {
		const current = field;
		if (!current) return;
		const settle = (): void => {
			focused = current.ownerDocument.activeElement === current;
		};
		const settleAfterEvent = (): void => queueMicrotask(settle);
		settle();
		current.addEventListener('focus', settleAfterEvent);
		current.addEventListener('blur', settleAfterEvent);
		return () => {
			current.removeEventListener('focus', settleAfterEvent);
			current.removeEventListener('blur', settleAfterEvent);
		};
	});

	$effect(() => {
		const current = field;
		if (!current || !masked) return;
		const style = getComputedStyle(current);
		metrics = [
			`padding-left:calc(${style.paddingLeft} + ${style.borderLeftWidth})`,
			`padding-right:calc(${style.paddingRight} + ${style.borderRightWidth})`,
			multiline ? `padding-top:calc(${style.paddingTop} + ${style.borderTopWidth})` : '',
			`font-family:${style.fontFamily}`,
			`font-size:${style.fontSize}`,
			`font-weight:${style.fontWeight}`,
			`line-height:${style.lineHeight}`,
			`letter-spacing:${style.letterSpacing}`,
		]
			.filter(Boolean)
			.join(';');
		current.style.setProperty('color', 'transparent');
		return () => current.style.removeProperty('color');
	});
</script>

{#if masked}
	<span
		class={[
			'hyper-sensitive-mask text-fg-default pointer-events-none absolute inset-0 overflow-hidden',
			multiline ? 'break-words whitespace-pre-wrap' : 'flex items-center whitespace-pre',
		]}
		style={metrics}
		aria-hidden="true"
		data-testid="sensitive-field-mask"
	>
		{value}
	</span>
{/if}
