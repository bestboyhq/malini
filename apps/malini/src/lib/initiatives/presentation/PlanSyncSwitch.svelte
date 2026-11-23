<script lang="ts">
	import { Switch } from '$hyper-ui/components/switch';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { setPlanSyncCommand } from '$lib/initiatives/application/commands/set-plan-sync.command';
	import { planSyncQuery } from '$lib/initiatives/application/queries/plan-sync.query.svelte';
	import { syncedLabel } from '$lib/initiatives/domain/plan';
	import PlanSyncStatus from './PlanSyncStatus.svelte';

	interface Props {
		repositoryFullName: string;
		compact: boolean;
	}

	let { repositoryFullName, compact }: Props = $props();

	const LABEL = 'Share internally';

	const switchId = $props.id();

	const sync = $derived(planSyncQuery.data(repositoryFullName));
	const home = $derived(sync?.home ?? null);
	const who = $derived(`Only collaborators of ${repositoryFullName} see it`);
	const whatOnDoes = $derived(`Private repo ${home}, as one plain file. ${who}`);
	const whatOffDoes = $derived(
		`Private repo ${home}. ${who}. Turning it off stops sharing. The repo keeps its history`,
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
	const compactLead = $derived(sync?.enabled ? status : 'Private GitHub repo, as one plain file');

	$effect(() => {
		if (!compact || sync?.enabled !== true) return;
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	function onchange(checked: boolean): void {
		setPlanSyncCommand(repositoryFullName, checked);
	}
</script>

{#snippet compactTip()}
	<span class="block">{compactLead}</span>
	<span class="block">{who}</span>
{/snippet}

{#if sync && home !== null && compact}
	<Tooltip content={compactTip} placement="top" class="flex min-w-0 items-center gap-1.5">
		<label
			for={switchId}
			class={[
				'min-w-0 cursor-pointer truncate @max-[13rem]:sr-only',
				failed && 'text-error-content',
			]}
		>
			{LABEL}
		</label>
		<Switch id={switchId} size="sm" checked={sync.enabled} {onchange} />
	</Tooltip>
{:else if sync && home !== null}
	<div class="mb-5 flex items-start gap-3">
		<div class="min-w-0 flex-1">
			<label for={switchId} class="text-fg-default cursor-pointer text-sm font-medium">
				{LABEL}
			</label>
			{#if sync.enabled}
				<div class="text-3xs text-fg-tertiary mt-1 flex h-4 max-w-80 items-center gap-2">
					<PlanSyncStatus {sync} />
				</div>
			{/if}
			<p class="text-2xs text-fg-tertiary mt-1">{sync.enabled ? whatOffDoes : whatOnDoes}</p>
		</div>
		<Switch id={switchId} size="sm" checked={sync.enabled} class="mt-0.5" {onchange} />
	</div>
{/if}
