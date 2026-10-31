<script lang="ts">
	interface Props {
		name: string;
		size?: 'md' | 'lg';
	}

	let { name, size = 'md' }: Props = $props();

	const initial = $derived(name.trim().charAt(0).toUpperCase() || '?');
</script>

<span
	class={[
		'border-chip-border bg-chip text-fg-secondary grid shrink-0 place-items-center border-[0.5px] font-semibold',
		size === 'lg' ? 'size-10 rounded-xl text-base' : 'size-7 rounded-lg text-xs',
	]}
	aria-hidden="true"
>
	{initial}
</span>
