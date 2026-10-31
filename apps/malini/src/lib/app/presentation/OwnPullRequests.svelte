<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { describeFailure } from '$shared/errors/failure-copy';
	import {
		continueOwnPullRequestCommand,
		loadOwnPullRequestsCommand,
		ownPullRequestsQuery,
		type OwnPullRequest,
	} from '$shared/repositories/repositories.api';
	import { formatTimeAgo } from '$lib/stats/stats.api';

	interface Props {
		repositoryId: string;
	}

	let { repositoryId }: Props = $props();

	const TITLE_ID = 'own-pull-requests-title';
	const CLOCK_MS = 30_000;

	const own = $derived(ownPullRequestsQuery.data(repositoryId));
	const continuing = $derived(ownPullRequestsQuery.continuing);
	let nowMs = $state(Date.now());

	$effect(() => {
		loadOwnPullRequestsCommand(repositoryId);
	});

	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), CLOCK_MS);
		return () => clearInterval(clock);
	});

	function ago(iso: string): string {
		const at = Date.parse(iso);
		return Number.isNaN(at) ? '' : formatTimeAgo(Math.max(0, nowMs - at));
	}

	function opensHere(pullRequest: OwnPullRequest): boolean {
		return pullRequest.workstream === 'active';
	}
</script>

<aside
	class="border-surface-50-border flex w-72 shrink-0 flex-col overflow-y-auto border-l-[0.5px] px-3 pt-20 pb-6"
	aria-labelledby={TITLE_ID}
	data-testid="own-pull-requests"
>
	<h2
		id={TITLE_ID}
		class="text-fg-tertiary mb-1.5 flex items-center gap-1.5 px-2 text-xs font-medium"
	>
		<Icon name="pr-open" size={12} />
		Your open pull requests
	</h2>
	{#if own.status === 'ready'}
		{#if own.pullRequests.length === 0}
			<p class="text-fg-quaternary px-2 text-xs">None in this repository.</p>
		{:else}
			<ul class="flex flex-col" aria-labelledby={TITLE_ID}>
				{#each own.pullRequests as pullRequest (pullRequest.head)}
					{@const busy = continuing(pullRequest.head)}
					{@const here = opensHere(pullRequest)}
					<li
						class="group/pr hover:bg-surface-50-hover focus-within:bg-surface-50-hover rounded-lg"
						data-testid="own-pull-request"
					>
						<Button
							bare
							class="flex w-full cursor-pointer flex-col gap-0.5 px-2 py-1.5 text-left outline-none disabled:cursor-default"
							ariaLabel={here ? `Open ${pullRequest.title}` : `Continue ${pullRequest.title} here`}
							ariaBusy={busy}
							disabled={busy}
							onclick={() => continueOwnPullRequestCommand(repositoryId, pullRequest)}
						>
							<span
								class="text-fg-secondary group-focus-within/pr:text-fg-default group-hover/pr:text-fg-default line-clamp-2 text-sm"
							>
								<SensitiveText text={pullRequest.title} />
							</span>
							<span class="flex items-center gap-1.5 text-xs" aria-hidden="true">
								<Icon
									name={pullRequest.draft ? 'pr-draft' : 'pr-open'}
									size={11}
									class="text-fg-tertiary shrink-0"
								/>
								{#if busy}
									<span class="text-fg-tertiary flex items-center gap-1">
										<BusyIcon size={11} />
										Continuing
									</span>
								{:else}
									<span
										class="text-fg-quaternary truncate tabular-nums group-focus-within/pr:hidden group-hover/pr:hidden"
									>
										#{pullRequest.number}{pullRequest.draft ? ' · Draft' : ''} · {ago(
											pullRequest.updatedAt,
										)}
									</span>
									<span
										class="text-fg-tertiary hidden items-center gap-1 group-focus-within/pr:flex group-hover/pr:flex"
									>
										<Icon name={here ? 'arrow-right' : 'play'} size={11} />
										{here ? 'Open' : 'Continue here'}
									</span>
								{/if}
							</span>
						</Button>
					</li>
				{/each}
			</ul>
		{/if}
	{:else if own.status === 'failed'}
		{@const failure = describeFailure(own.error, { subject: 'Your pull requests' })}
		<p class="text-fg-quaternary px-2 text-xs" role="status">{failure.detail} {failure.remedy}</p>
	{/if}
</aside>
