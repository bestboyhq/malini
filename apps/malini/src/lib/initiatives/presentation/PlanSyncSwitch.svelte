<script lang="ts">
	import { Switch } from '$hyper-ui/components/switch';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { setPlanSyncCommand } from '$lib/initiatives/application/commands/set-plan-sync.command';
	import { planSyncQuery } from '$lib/initiatives/application/queries/plan-sync.query.svelte';
	import { peopleLine, syncedLabel } from '$lib/initiatives/domain/plan';
	import PlanSyncStatus from './PlanSyncStatus.svelte';

	interface Props {
		repositoryFullName: string;
		compact: boolean;
	}

	let { repositoryFullName, compact }: Props = $props();

	const LABEL = 'Share internally';

	const WAITING_ENDS = 'Shares by itself once they do';

	const REPOSITORY_NAME = /([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)/u;

	const switchId = $props.id();

	const sync = $derived(planSyncQuery.data(repositoryFullName));
	const home = $derived(sync?.home ?? null);
	const waitingFor = $derived(sync?.enabled ? sync.waitingFor : null);
	const askers = $derived(sync?.enabled === false ? sync.requestedBy : []);
	const asked = $derived(`${peopleLine(askers)} asked to share it`);
	const label = $derived(waitingFor === null ? LABEL : `Asked ${waitingFor}`);
	const who = $derived(`Only collaborators of ${repositoryFullName} see it`);
	const waiting = $derived(`Waiting for ${waitingFor} to make the plan repo`);
	const whatOnDoes = $derived(
		`${askers.length > 0 ? `${asked}. ` : ''}Private repo ${home}, as one plain file. ${who}`,
	);
	const whatOffDoes = $derived(
		waitingFor === null
			? `Private repo ${home}. ${who}. Turning it off stops sharing. The repo keeps its history`
			: `${waiting}, ${home}. ${WAITING_ENDS}. Turning it off takes the ask back`,
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
	const compactLines = $derived(
		waitingFor !== null
			? [waiting, WAITING_ENDS]
			: askers.length > 0
				? [asked, 'Private GitHub repo, as one plain file']
				: [sync?.enabled ? status : 'Private GitHub repo, as one plain file', who],
	);

	$effect(() => {
		if (!compact || sync?.enabled !== true || waitingFor !== null) return;
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	function onchange(checked: boolean): void {
		setPlanSyncCommand(repositoryFullName, checked);
	}
</script>

{#snippet compactTip()}
	{#each compactLines as line (line)}
		<span class="block">{line}</span>
	{/each}
{/snippet}

{#snippet wholeNames(text: string)}
	{#each text.split(REPOSITORY_NAME) as part, index (index)}
		{#if index % 2 === 1}<span class="whitespace-nowrap">{part}</span>{:else}{part}{/if}
	{/each}
{/snippet}

{#snippet askedDot()}
	{#if askers.length > 0}
		<span class="bg-brand size-1.5 shrink-0 rounded-full" role="img" aria-label={asked}></span>
	{/if}
{/snippet}

{#if sync && home !== null && compact}
	<Tooltip content={compactTip} placement="top" class="flex min-w-0 items-center gap-1.5">
		{@render askedDot()}
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
{:else if sync && home !== null}
	<div class="mb-5 flex items-start gap-3">
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-1.5">
				{@render askedDot()}
				<label for={switchId} class="text-fg-default cursor-pointer text-sm font-medium">
					{label}
				</label>
			</div>
			{#if sync.enabled && waitingFor === null}
				<div class="text-3xs text-fg-tertiary mt-1 flex h-4 max-w-80 items-center gap-2">
					<PlanSyncStatus {sync} />
				</div>
			{/if}
			<p class="text-2xs text-fg-tertiary mt-1">
				{@render wholeNames(sync.enabled ? whatOffDoes : whatOnDoes)}
			</p>
		</div>
		<Switch id={switchId} size="sm" checked={sync.enabled} class="mt-0.5" {onchange} />
	</div>
{/if}
