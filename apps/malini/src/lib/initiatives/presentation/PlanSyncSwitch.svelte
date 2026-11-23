<script lang="ts">
	import { Switch } from '$hyper-ui/components/switch';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { setPlanSyncCommand } from '$lib/initiatives/application/commands/set-plan-sync.command';
	import { planSyncQuery } from '$lib/initiatives/application/queries/plan-sync.query.svelte';
	import { peopleLine, syncedLabel } from '$lib/initiatives/domain/plan';
	import { GitHubUserAvatar } from '$shared/repositories/repositories.api';

	interface Props {
		repositoryFullName: string;
		withPeople: boolean;
	}

	let { repositoryFullName, withPeople }: Props = $props();

	const LABEL = 'Share internally';

	const WAITING_ENDS = 'Shares by itself once they do';

	const TAKES_THE_ASK_BACK = 'Turning it off takes the ask back';

	const PEOPLE_SHOWN = 4;

	const REPOSITORY_NAME = /([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)/u;

	const switchId = $props.id();

	const sync = $derived(planSyncQuery.data(repositoryFullName));
	const home = $derived(sync?.home ?? null);
	const waitingFor = $derived(sync?.enabled ? sync.waitingFor : null);
	const askers = $derived(sync?.enabled === false ? sync.requestedBy : []);
	const asked = $derived(`${peopleLine(askers)} asked to share it`);
	const label = $derived(waitingFor === null ? LABEL : `Asked ${waitingFor}`);
	const where = $derived(`Private repo ${home}`);
	const who = $derived(`Only collaborators of ${repositoryFullName} see it`);
	const people = $derived(
		withPeople && sync?.enabled && waitingFor === null ? sync.people.slice(0, PEOPLE_SHOWN) : [],
	);

	let now: number = $state(Date.now());

	const failed = $derived(sync?.enabled === true && sync.error !== null);
	const status = $derived(
		sync === null
			? ''
			: sync.error === null
				? syncedLabel(sync.syncedAt, now)
				: `Not shared · ${sync.error}`,
	);
	const lines = $derived(
		waitingFor !== null
			? [
					`Waiting for ${waitingFor} to make the plan repo, ${home}`,
					WAITING_ENDS,
					TAKES_THE_ASK_BACK,
				]
			: sync?.enabled
				? [status, where, who]
				: [...(askers.length > 0 ? [asked] : []), `${where}, as one plain file`, who],
	);

	$effect(() => {
		if (sync?.enabled !== true || waitingFor !== null) return;
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	function onchange(checked: boolean): void {
		setPlanSyncCommand(repositoryFullName, checked);
	}
</script>

{#snippet wholeNames(text: string)}
	{#each text.split(REPOSITORY_NAME) as part, index (index)}
		{#if index % 2 === 1}<span class="whitespace-nowrap">{part}</span>{:else}{part}{/if}
	{/each}
{/snippet}

{#snippet tip()}
	{#each lines as line (line)}
		<span class="block whitespace-normal">{@render wholeNames(line)}</span>
	{/each}
{/snippet}

{#if sync && home !== null}
	{#if people.length > 0}
		<span
			class="mr-1 flex shrink-0 items-center -space-x-1"
			role="group"
			aria-label="People who edited the plan"
		>
			{#each people as login (login)}
				<GitHubUserAvatar {login} label={login} />
			{/each}
		</span>
	{/if}
	<Tooltip content={tip} placement="top" nowrap class="flex min-w-0 items-center gap-1.5">
		{#if askers.length > 0}
			<span class="bg-brand size-1.5 shrink-0 rounded-full" role="img" aria-label={asked}></span>
		{/if}
		<label
			for={switchId}
			class={[
				'min-w-0 cursor-pointer truncate @max-[13rem]:sr-only',
				failed && 'text-error-content',
			]}
		>
			{label}
		</label>
		<Switch id={switchId} size="sm" checked={sync.enabled} {onchange} />
	</Tooltip>
{/if}
