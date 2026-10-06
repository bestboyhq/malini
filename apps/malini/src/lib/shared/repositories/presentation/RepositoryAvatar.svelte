<script lang="ts">
	import { onMount } from 'svelte';
	import { loadRepositoryAvatarCommand } from '$shared/repositories/application/commands/load-repository-avatar.command';
	import { repositoryAvatarQuery } from '$shared/repositories/application/queries/repository-avatar.query.svelte';
	import {
		githubOwnerFromFullName,
		repositoryInitial,
	} from '$shared/repositories/domain/repository-context';

	interface Props {
		fullName: string;
		size?: number;
		class?: string;
	}

	let { fullName, size = 20, class: className = '' }: Props = $props();

	const avatarUrl = $derived(repositoryAvatarQuery.data);
	const src = $derived(avatarUrl(fullName));
	const letter = $derived(
		githubOwnerFromFullName(fullName)?.charAt(0).toUpperCase() ?? repositoryInitial(fullName),
	);

	onMount(() => {
		loadRepositoryAvatarCommand(fullName);
	});
</script>

<span
	class={['relative block shrink-0 overflow-hidden rounded-md', className]}
	style:width="{size}px"
	style:height="{size}px"
	style:font-size="{size}px"
	data-testid="repository-avatar"
	data-avatar-state={src ? 'image' : 'letter'}
>
	{#if src}
		<img {src} alt="" draggable="false" class="block h-full w-full object-cover" />
	{:else}
		<span
			class="bg-surface-150 text-fg-secondary grid h-full w-full place-items-center text-[0.6em] leading-none font-medium select-none"
			aria-hidden="true"
		>
			{letter}
		</span>
	{/if}
</span>
