<script lang="ts">
	interface Props {
		label: string;
	}

	let { label }: Props = $props();
</script>

<span class="text-fg-tertiary text-2xs w-8 shrink-0">{label}</span>
