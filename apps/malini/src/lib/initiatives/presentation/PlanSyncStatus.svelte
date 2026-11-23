<script lang="ts">
	import { GitHubUserAvatar } from '$shared/repositories/repositories.api';
	import type { PlanSync } from '$contract/initiatives';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { GitHubIcon } from '$hyper-ui/icons';
	import { syncedLabel } from '$lib/initiatives/domain/plan';

	interface Props {
		sync: PlanSync;
	}

	let { sync }: Props = $props();

	const PEOPLE_SHOWN = 4;

	let now: number = $state(Date.now());

	const status = $derived(
		sync.error === null ? syncedLabel(sync.syncedAt, now) : `Not shared · ${sync.error}`,
	);
	const people = $derived(sync.people.slice(0, PEOPLE_SHOWN));

	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});
</script>

<span class="flex min-w-0 flex-1 items-center gap-1.5">
	<GitHubIcon size={12} class="shrink-0" />
	<Tooltip content={status} placement="top" onlyWhenTruncated class="min-w-0">
		<span class="block truncate">{status}</span>
	</Tooltip>
</span>
{#if people.length > 0}
	<span
		class="flex shrink-0 items-center -space-x-1"
		role="group"
		aria-label="People who edited the plan"
	>
		{#each people as login (login)}
			<GitHubUserAvatar {login} label={login} />
		{/each}
	</span>
{/if}
