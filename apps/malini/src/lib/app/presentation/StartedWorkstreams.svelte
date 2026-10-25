<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { BusyIcon, Icon, type IconName } from '$hyper-ui/icons';
	import { openExternalUrlCommand } from '$lib/app/application/commands/open-external-url.command';
	import { leadProgressQuery } from '$lib/app/application/queries/lead-progress.query.svelte';
	import { standingLabel, type ProgressDot } from '$lib/app/domain/lead-progress';
	import {
		pullRequestBadgesQuery,
		type PullRequestPhase,
	} from '$lib/pull-requests/application/queries/pull-request-badges.query.svelte';
	import {
		pullRequestLinkQuery,
		type PullRequestLink,
	} from '$lib/pull-requests/application/queries/pull-request-link.query.svelte';
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
		| Readonly<{ kind: 'archived'; archivedAt: number }>
		| null;

	type Line = Readonly<{
		id: string;
		fullName: string | null;
		name: string;
		dot: ProgressDot;
		glyph: IconName;
		label: string;
		trail: Trail;
		pullRequest: PullRequestLink | null;
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

	const gapClass = $derived(framed ? 'gap-2.5' : 'gap-2');
	const rowClass = $derived(
		framed ? 'h-10 pr-3.5 pl-3.5 text-sm' : 'h-8 rounded-xl pr-2 pl-2 text-xs',
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
					pullRequest: pullRequestLinkQuery.data(id),
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
				trail: Number.isNaN(archivedAt) ? null : { kind: 'archived', archivedAt },
				pullRequest: pullRequest?.url ? { number: pullRequest.number, url: pullRequest.url } : null,
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

	function swapsOnHover(line: Line): string | false {
		return line.pullRequest !== null && 'group-focus-within/row:hidden group-hover/row:hidden';
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

{#snippet identity(line: Line)}
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
{/snippet}

{#snippet trail(line: Line)}
	{#if line.trail?.kind === 'changes'}
		<span
			class={[
				'text-2xs flex shrink-0 gap-1 font-mono font-medium tabular-nums',
				swapsOnHover(line),
			]}
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
		<span
			class={['text-fg-tertiary text-2xs shrink-0 tabular-nums', swapsOnHover(line)]}
			aria-hidden="true"
		>
			{ageOf(line.trail.archivedAt)}
		</span>
	{/if}
{/snippet}

{#snippet list()}
	<ul aria-label={framed ? undefined : 'Workstreams'}>
		{#each lines as line (line.id)}
			{@const accessibleName = accessibleNameOf(line)}
			<li
				class={[
					'group/row relative flex items-center',
					gapClass,
					rowClass,
					framed && 'border-surface-50-border border-t-[0.5px]',
					(line.open || line.pullRequest) && 'hover:bg-surface-50-hover',
				]}
			>
				{#if line.open}
					<Button
						bare
						href={workstreamHref(line.id)}
						ariaLabel={accessibleName}
						class={[
							'focus-visible:after:ring-border-default/50 flex min-w-0 flex-1 items-center outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-2',
							gapClass,
						]}
						data-testid="started-workstream"
					>
						{@render identity(line)}
					</Button>
				{:else}
					<div
						class={['flex min-w-0 flex-1 items-center', gapClass]}
						role="group"
						aria-label={accessibleName}
						data-testid="started-workstream"
					>
						{@render identity(line)}
					</div>
				{/if}
				{#if line.pullRequest}
					{@const { number, url } = line.pullRequest}
					<Button
						bare
						ariaLabel={`Open pull request #${number} on GitHub`}
						class="text-fg-tertiary hover:text-fg-default focus-visible:ring-border-default/50 text-2xs relative hidden shrink-0 items-center gap-0.5 rounded-md tabular-nums outline-none group-focus-within/row:inline-flex group-hover/row:inline-flex focus-visible:ring-2"
						data-testid="started-workstream-pull-request"
						onclick={() => openExternalUrlCommand(url)}
					>
						#{number}
						<Icon name="external-link" size={11} />
					</Button>
				{/if}
				{@render trail(line)}
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
