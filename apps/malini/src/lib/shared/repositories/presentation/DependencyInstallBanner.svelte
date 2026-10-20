<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { dismissDependencyInstallCommand } from '$shared/repositories/application/commands/dismiss-dependency-install.command';
	import { retryDependencyInstallCommand } from '$shared/repositories/application/commands/retry-dependency-install.command';
	import { dependencyInstallQuery } from '$shared/repositories/application/queries/dependency-install.query.svelte';
	import type { WorkstreamInstallRecord } from '$shared/repositories/domain/provisioning';

	interface Props {
		workstreamId: string;
	}

	let { workstreamId }: Props = $props();

	const installRecord = $derived(dependencyInstallQuery.data(workstreamId));
	let revealedRecord = $state.raw<WorkstreamInstallRecord | null>(null);
	const dependencyInstall = $derived(
		installRecord && (revealedRecord === installRecord || installRecord.noticeAt <= Date.now())
			? installRecord
			: null,
	);

	$effect(() => {
		const record = installRecord;
		if (!record) return;
		const wait = record.noticeAt - Date.now();
		if (wait <= 0) return;
		const timer = setTimeout(() => {
			revealedRecord = record;
		}, wait);
		return () => clearTimeout(timer);
	});
</script>

{#if dependencyInstall}
	<div
		role="status"
		aria-live="polite"
		data-testid="workstream-dependency-install"
		data-install-status={dependencyInstall.status}
		class="border-surface-50-border bg-surface-50 text-fg-secondary flex w-full shrink-0 items-center gap-2 border-b px-4 py-2"
	>
		<span class="grid h-4 w-4 shrink-0 place-items-center" aria-hidden="true">
			{#if dependencyInstall.status === 'running'}
				<BusyIcon size={13} />
			{:else}
				<Icon name="alert" size={14} />
			{/if}
		</span>
		<p class="text-2xs min-w-0 flex-1 truncate leading-4">
			{#if dependencyInstall.status === 'running'}
				Installing dependencies{dependencyInstall.command ? ` · ${dependencyInstall.command}` : ''}
			{:else if dependencyInstall.status === 'unavailable'}
				Nothing here says how to install dependencies, so none were installed.
			{:else}
				{dependencyInstall.command ?? 'Installing dependencies'} failed{dependencyInstall.detail
					? ` · ${dependencyInstall.detail}`
					: ''}
			{/if}
		</p>
		{#if dependencyInstall.status === 'failed'}
			<Button
				variant="inherit"
				size="auto"
				class="text-2xs text-fg-default shrink-0 px-2 py-1"
				data-testid="workstream-dependency-install-retry"
				onclick={() => retryDependencyInstallCommand(workstreamId)}
			>
				Retry
			</Button>
		{/if}
		{#if dependencyInstall.status !== 'running'}
			<Button
				variant="inherit"
				size="auto"
				class="text-2xs text-fg-tertiary shrink-0 px-2 py-1 font-normal"
				data-testid="workstream-dependency-install-dismiss"
				onclick={() => dismissDependencyInstallCommand(workstreamId)}
			>
				Dismiss
			</Button>
		{/if}
	</div>
{/if}
