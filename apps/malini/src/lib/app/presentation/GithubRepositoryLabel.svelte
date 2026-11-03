<script lang="ts">
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import {
		RepositoryAvatar,
		repositoryName,
		repositoryOwner,
		type GithubRepository,
		type GithubRepositoryState,
	} from '$shared/repositories/repositories.api';
	import { formatTimeAgo } from '$lib/stats/stats.api';

	interface Props {
		repository: GithubRepository;
		state: GithubRepositoryState;
		nowMs: number;
	}

	let { repository, state, nowMs }: Props = $props();

	const owner = $derived(
		repositoryOwner(repository.fullName) ? `${repositoryOwner(repository.fullName)}/` : '',
	);
	const name = $derived(repositoryName(repository.fullName));
	const pushedAt = $derived(
		repository.pushedAt === null ? Number.NaN : Date.parse(repository.pushedAt),
	);
</script>

<RepositoryAvatar fullName={repository.fullName} size={20} />
<span class="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
	<span class="sr-only">{repository.fullName}</span>
	<span class="flex min-w-0" aria-hidden="true">
		<span class="text-fg-tertiary shrink-0">{owner}</span>
		<span class="text-fg-default truncate">{name}</span>
	</span>
	{#if repository.private}
		<Icon name="lock" size={12} class="text-fg-tertiary shrink-0" ariaLabel="Private" />
	{/if}
</span>
<span class="text-fg-tertiary flex shrink-0 items-center gap-1.5 text-sm tabular-nums">
	{#if state.kind === 'cloning'}
		<BusyIcon size={13} />
	{:else if state.kind === 'failed'}
		<span class="text-error-content flex items-center gap-1.5">
			<Icon name="alert" size={14} />Did not clone. Retry
		</span>
	{:else if !Number.isNaN(pushedAt)}
		{formatTimeAgo(Math.max(0, nowMs - pushedAt))}
	{/if}
</span>
