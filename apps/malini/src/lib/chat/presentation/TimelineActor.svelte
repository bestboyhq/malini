<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import {
		RepositoryAvatar,
		repositoryContextQuery,
		repositoryName,
		workstreamNameQuery,
	} from '$shared/repositories/repositories.api';
	import { workstreamHref } from '$shared/router/routes-hrefs';

	interface Props {
		workstreamId: string | null;
		fallback?: string;
	}

	let { workstreamId, fallback = 'a workstream' }: Props = $props();

	const fullName = $derived(
		workstreamId === null
			? null
			: (repositoryContextQuery.data(workstreamId)?.repo.fullName ?? null),
	);
	const name = $derived(workstreamId === null ? null : workstreamNameQuery.data(workstreamId));
	const shown = $derived(fullName ? repositoryName(fullName) : (name ?? fallback));
</script>

{#if workstreamId}
	<Button
		bare
		href={workstreamHref(workstreamId)}
		ariaLabel={name && name !== shown ? `${shown}, ${name}` : shown}
		class="text-fg-default hover:text-fg-agent-message-strong inline-flex max-w-full items-center gap-1.5 align-bottom font-medium"
	>
		{#if fullName}
			<RepositoryAvatar {fullName} size={16} class="shrink-0" />
		{/if}
		<span class="truncate">{shown}</span>
	</Button>
{:else}
	<span class="text-fg-default font-medium">{shown}</span>
{/if}
