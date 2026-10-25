<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { BusyIcon, Icon, type IconName } from '$hyper-ui/icons';
	import { leadProgressQuery } from '$lib/app/application/queries/lead-progress.query.svelte';
	import { standingLabel, type ProgressDot } from '$lib/app/domain/lead-progress';
	import {
		pullRequestBadgesQuery,
		type PullRequestPhase,
	} from '$lib/pull-requests/application/queries/pull-request-badges.query.svelte';
	import {
		RepositoryAvatar,
		archivedWorkstreamsQuery,
		repositoryContextQuery,
		workstreamByIdQuery,
		workstreamNameQuery,
	} from '$shared/repositories/repositories.api';
	import { workstreamHref } from '$shared/router/routes-hrefs';

	interface Props {
		workstreamIds: readonly string[];
		framed?: boolean;
	}

	let { workstreamIds, framed = true }: Props = $props();

	type Line = Readonly<{
		id: string;
		fullName: string | null;
		name: string;
		dot: ProgressDot;
		pullRequest: PullRequestPhase;
		label: string;
		open: boolean;
	}>;

	const TONE: Readonly<Record<ProgressDot, string>> = {
		merged: 'text-merged-content',
		needs: 'text-warning-content',
		failed: 'text-error-content',
		running: 'text-fg-secondary',
		idle: 'text-fg-tertiary',
	};

	const PILL: Readonly<Record<ProgressDot, string>> = {
		merged: 'bg-merged-surface text-merged-content',
		needs: 'bg-warning text-warning-content',
		failed: 'bg-error text-error-content',
		running: 'bg-surface-100 text-fg-secondary',
		idle: 'bg-surface-100 text-fg-secondary',
	};

	const rowClass = $derived(
		framed ? 'h-10 gap-2.5 pr-2.5 pl-3.5 text-sm' : 'h-8 gap-2 rounded-xl pr-1 pl-2 text-xs',
	);
	const lines = $derived(workstreamIds.flatMap(lineOf));
	const merged = $derived(lines.filter((line) => line.dot === 'merged').length);

	function lineOf(id: string): Line[] {
		const name = workstreamNameQuery.data(id) ?? '';
		const active = workstreamByIdQuery.data(id);
		if (active) {
			const dot = leadProgressQuery.dot(active);
			const pullRequest = pullRequestBadgesQuery.data(id).phase;
			const fullName = repositoryContextQuery.data(id)?.repo.fullName ?? null;
			const label = standingLabel(dot, pullRequest);
			return [{ id, fullName, name, dot, pullRequest, label, open: true }];
		}
		const archived = archivedWorkstreamsQuery.data.find((entry) => entry.id === id);
		if (!archived) return [];
		const pullRequest = archived.mergedPullRequest;
		return [
			{
				id,
				fullName: archived.repositoryFullName,
				name,
				dot: pullRequest ? 'merged' : 'idle',
				pullRequest: pullRequest ? 'merged' : 'none',
				label: pullRequest
					? `Merged #${pullRequest.number}`
					: archived.savedForLater
						? 'Saved for later'
						: 'Archived',
				open: false,
			},
		];
	}

	function glyphOf(line: Line): IconName {
		if (line.dot === 'merged') return 'pr-merged';
		if (line.dot === 'needs') return 'alert';
		if (line.dot === 'failed') return 'pr-failed';
		if (line.pullRequest === 'open') return 'pr-open';
		return line.pullRequest === 'draft' ? 'pr-draft' : 'branch';
	}

	function repositoryName(fullName: string): string {
		return fullName.slice(fullName.lastIndexOf('/') + 1);
	}
</script>

{#snippet content(line: Line)}
	<span class={['flex shrink-0', TONE[line.dot]]}>
		{#if line.dot === 'running'}
			<BusyIcon size={14} />
		{:else}
			<Icon name={glyphOf(line)} size={14} />
		{/if}
	</span>
	{#if line.fullName}
		<RepositoryAvatar fullName={line.fullName} size={16} />
	{/if}
	<span class="text-fg-default min-w-0 flex-1 truncate font-medium">
		{line.fullName ? repositoryName(line.fullName) : line.name}
	</span>
	<span
		class={[
			'text-2xs inline-flex h-[22px] shrink-0 items-center rounded-full px-2 font-medium',
			PILL[line.dot],
		]}
	>
		{line.label}
	</span>
{/snippet}

{#snippet list()}
	<ul aria-label={framed ? undefined : 'Workstreams'}>
		{#each lines as line (line.id)}
			{@const accessibleName = `${line.fullName ?? line.name}, ${line.name}, ${line.label}`}
			<li class={framed ? 'border-surface-50-border border-t-[0.5px]' : undefined}>
				{#if line.open}
					<Button
						bare
						href={workstreamHref(line.id)}
						ariaLabel={accessibleName}
						class={['hover:bg-surface-50-hover flex w-full items-center', rowClass]}
						data-testid="started-workstream"
					>
						{@render content(line)}
					</Button>
				{:else}
					<div
						class={['flex items-center', rowClass]}
						role="group"
						aria-label={accessibleName}
						data-testid="started-workstream"
					>
						{@render content(line)}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

{#if lines.length > 0 && framed}
	<section
		class="bg-surface-50 border-surface-50-border overflow-hidden rounded-xl border-[0.5px]"
		aria-label="Workstreams"
		data-testid="started-workstreams"
	>
		<h3 class="text-fg-secondary flex items-center gap-2 px-3.5 pt-2.5 pb-2 text-xs font-medium">
			Workstreams
			<span class="text-fg-tertiary ml-auto font-normal">
				{merged} of {lines.length} merged
			</span>
		</h3>
		{@render list()}
	</section>
{:else if lines.length > 0}
	{@render list()}
{/if}
