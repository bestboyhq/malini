<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { loadGithubUserAvatarCommand } from '$shared/repositories/application/commands/load-github-user-avatar.command';
	import { githubUserAvatarQuery } from '$shared/repositories/application/queries/github-user-avatar.query.svelte';

	interface Props {
		login: string;
		label: string;
		size?: number;
		class?: ClassValue;
	}

	let { login, label, size = 16, class: className }: Props = $props();

	const src = $derived(githubUserAvatarQuery.data(login));

	$effect(() => loadGithubUserAvatarCommand(login));
</script>

<Tooltip content={label} placement="top" class={['flex shrink-0', className]}>
	<span
		class="bg-surface-150 text-fg-secondary ring-border-subtle grid shrink-0 place-items-center overflow-hidden rounded-full text-[9px] leading-none font-semibold ring-[0.5px] select-none"
		style:width="{size}px"
		style:height="{size}px"
		role="img"
		aria-label={label}
	>
		{#if src}
			<img {src} alt="" draggable="false" class="block size-full object-cover" />
		{:else}
			{login.charAt(0).toUpperCase()}
		{/if}
	</span>
</Tooltip>
