<script lang="ts">
	interface Props {
		label: string;
	}

	let { label }: Props = $props();
</script>

<span class="text-fg-tertiary text-2xs grid shrink-0">
	<span class="invisible [grid-area:1/1]" aria-hidden="true">Automation</span>
	<span class="[grid-area:1/1]">{label}</span>
</span>
