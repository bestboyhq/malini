<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { BusyIcon, Icon, type IconName } from '$hyper-ui/icons';
	import { leadProgressQuery } from '$lib/app/application/queries/lead-progress.query.svelte';
	import { standingLabel, type ProgressDot } from '$lib/app/domain/lead-progress';
	import {
		pullRequestBadgesQuery,
		type PullRequestPhase,
	} from '$lib/pull-requests/application/queries/pull-request-badges.query.svelte';
	import { formatCompactChangeTotal } from '$lib/pull-requests/pull-requests.api';
	import { formatTimeAgo } from '$lib/stats/stats.api';
	import {
		RepositoryAvatar,
		archivedWorkstreamsQuery,
		changeTotalsQuery,
		repositoryContextQuery,
		repositoryName,
		workstreamByIdQuery,
		workstreamNameQuery,
	} from '$shared/repositories/repositories.api';
	import { workstreamHref } from '$shared/router/routes-hrefs';

	interface Props {
		workstreamIds: readonly string[];
		framed?: boolean;
	}

	let { workstreamIds, framed = true }: Props = $props();

	type Trail =
		| Readonly<{ kind: 'changes'; additions: number; deletions: number }>
		| Readonly<{ kind: 'archived'; pullRequestNumber: number | null; archivedAt: number }>
		| null;

	type Line = Readonly<{
		id: string;
		fullName: string | null;
		name: string;
		dot: ProgressDot;
		glyph: IconName;
		label: string;
		trail: Trail;
		open: boolean;
	}>;

	const CLOCK_MS = 60_000;

	const TONE: Readonly<Record<ProgressDot, string>> = {
		merged: 'text-merged-content',
		needs: 'text-warning-content',
		failed: 'text-error-content',
		running: 'text-fg-secondary',
		idle: 'text-fg-tertiary',
	};

	let nowMs = $state(Date.now());

	const rowClass = $derived(
		framed ? 'h-10 gap-2.5 pr-3.5 pl-3.5 text-sm' : 'h-8 gap-2 rounded-xl pr-2 pl-2 text-xs',
	);
	const lines = $derived(workstreamIds.flatMap(lineOf));
	const merged = $derived(lines.filter((line) => line.dot === 'merged').length);
	const showsAges = $derived(lines.some((line) => line.trail?.kind === 'archived'));

	$effect(() => {
		if (!showsAges) return;
		const clock = setInterval(() => (nowMs = Date.now()), CLOCK_MS);
		return () => clearInterval(clock);
	});

	function lineOf(id: string): Line[] {
		const name = workstreamNameQuery.data(id) ?? '';
		const active = workstreamByIdQuery.data(id);
		if (active) {
			const dot = leadProgressQuery.dot(active);
			const pullRequest = pullRequestBadgesQuery.data(id).phase;
			const totals = changeTotalsQuery.data[id];
			return [
				{
					id,
					fullName: repositoryContextQuery.data(id)?.repo.fullName ?? null,
					name,
					dot,
					glyph: glyphOf(dot, pullRequest),
					label: standingLabel(dot, pullRequest),
					trail:
						totals && (totals.additions > 0 || totals.deletions > 0)
							? { kind: 'changes', additions: totals.additions, deletions: totals.deletions }
							: null,
					open: true,
				},
			];
		}
		const archived = archivedWorkstreamsQuery.data.find((entry) => entry.id === id);
		if (!archived) return [];
		const pullRequest = archived.mergedPullRequest;
		const archivedAt = Date.parse(archived.archivedAt);
		return [
			{
				id,
				fullName: archived.repositoryFullName,
				name,
				dot: pullRequest ? 'merged' : 'idle',
				glyph: pullRequest ? 'pr-merged' : archived.savedForLater ? 'clock' : 'archive',
				label: pullRequest
					? `Merged #${pullRequest.number}`
					: archived.savedForLater
						? 'Saved for later'
						: 'Archived',
				trail: Number.isNaN(archivedAt)
					? null
					: { kind: 'archived', pullRequestNumber: pullRequest?.number ?? null, archivedAt },
				open: false,
			},
		];
	}

	function glyphOf(dot: ProgressDot, pullRequest: PullRequestPhase): IconName {
		if (dot === 'merged') return 'pr-merged';
		if (dot === 'needs') return 'alert';
		if (dot === 'failed') return 'pr-failed';
		if (pullRequest === 'open') return 'pr-open';
		return pullRequest === 'draft' ? 'pr-draft' : 'branch';
	}

	function ageOf(archivedAt: number): string {
		return formatTimeAgo(Math.max(0, nowMs - archivedAt));
	}

	function accessibleNameOf(line: Line): string {
		const trail = line.trail;
		const detail =
			trail?.kind === 'changes'
				? `${trail.additions} additions, ${trail.deletions} deletions`
				: trail?.kind === 'archived'
					? ageOf(trail.archivedAt)
					: null;
		return [line.fullName ?? line.name, line.name, line.label, detail].filter(Boolean).join(', ');
	}
</script>

{#snippet content(line: Line)}
	<span class={['flex shrink-0', TONE[line.dot]]}>
		{#if line.dot === 'running'}
			<BusyIcon size={14} />
		{:else}
			<Icon name={line.glyph} size={14} />
		{/if}
	</span>
	{#if line.fullName}
		<RepositoryAvatar fullName={line.fullName} size={16} />
	{/if}
	<span class="text-fg-default min-w-0 flex-1 truncate font-medium">
		{line.fullName ? repositoryName(line.fullName) : line.name}
	</span>
	{#if line.trail?.kind === 'changes'}
		<span
			class="text-2xs flex shrink-0 gap-1 font-mono font-medium tabular-nums"
			aria-hidden="true"
		>
			{#if line.trail.additions > 0}<span class="text-success-content">
					+{formatCompactChangeTotal(line.trail.additions)}
				</span>{/if}
			{#if line.trail.deletions > 0}<span class="text-error-content">
					−{formatCompactChangeTotal(line.trail.deletions)}
				</span>{/if}
		</span>
	{:else if line.trail?.kind === 'archived'}
		<span class="text-fg-tertiary text-2xs shrink-0 tabular-nums" aria-hidden="true">
			{#if line.trail.pullRequestNumber !== null}#{line.trail.pullRequestNumber} ·{/if}
			{ageOf(line.trail.archivedAt)}
		</span>
	{/if}
{/snippet}

{#snippet list()}
	<ul aria-label={framed ? undefined : 'Workstreams'}>
		{#each lines as line (line.id)}
			{@const accessibleName = accessibleNameOf(line)}
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
