<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Checkbox } from '$hyper-ui/components/checkbox';
	import { Textarea } from '$hyper-ui/components/textarea';
	import { Icon } from '$hyper-ui/icons';
	import { githubAuthQuery } from '$shared/repositories/repositories.api';
	import { DISCORD_URL, PROBLEM_TEXT_LIMIT } from '$lib/app/domain/problem-report';
	import { fileProblemCommand } from '$lib/app/application/commands/file-problem.command';
	import { openExternalUrlCommand } from '$lib/app/application/commands/open-external-url.command';
	import { problemReportQuery } from '$lib/app/application/queries/problem-report.query.svelte';

	interface Props {
		ondismiss: () => void;
	}

	let { ondismiss }: Props = $props();

	const problem = $derived(problemReportQuery.data);
	const login = $derived(githubAuthQuery.data?.login ?? null);
	const report = $derived(problem.report);
	const offered = $derived(
		report
			? [report.system, report.journey, report.lastError].filter(
					(fact): fact is string => fact !== null,
				)
			: [],
	);

	let text: string = $state('');
	let dropped: readonly string[] = $state([]);

	const kept = $derived(offered.filter((fact) => !dropped.includes(fact)));
	const empty = $derived(text.trim() === '');

	function onKeep(fact: string, checked: boolean): void {
		dropped = checked ? dropped.filter((other) => other !== fact) : [...dropped, fact];
	}
</script>

{#if problem.filed}
	{@const filed = problem.filed}
	<div class="flex items-center gap-3" data-testid="problem-filed">
		<span class="bg-success/15 text-success grid size-7 shrink-0 place-items-center rounded-full">
			<Icon name="check" size={15} />
		</span>
		<p class="min-w-0 flex-1 text-sm">
			<span class="text-fg-default block font-medium">Filed as #{filed.number}</span>
			<span class="text-fg-tertiary block">Replies show up on GitHub</span>
		</p>
		<Button variant="secondary" bordered onclick={() => openExternalUrlCommand(filed.url)}>
			Open on GitHub
		</Button>
		<Button variant="primary" onclick={ondismiss}>Done</Button>
	</div>
{:else}
	<div class="flex flex-col gap-4">
		<Textarea
			bind:value={text}
			rows={4}
			ariaLabel="What broke"
			placeholder="What broke, and what you expected"
			maxlength={PROBLEM_TEXT_LIMIT}
			disabled={problem.filing}
		/>

		<div class="border-border-subtle rounded-xl border p-1" role="group" aria-label="Goes with it">
			<p class="text-fg-tertiary px-2 pt-1.5 pb-0.5 text-xs" aria-hidden="true">Goes with it</p>
			{#if report}
				{#each offered as fact (fact)}
					<div class="hover:bg-surface-100 flex items-center gap-2 rounded-lg px-2 py-1.5">
						<Checkbox
							class="min-w-0 flex-1"
							checked={!dropped.includes(fact)}
							disabled={problem.filing}
							onchange={(checked) => onKeep(fact, checked)}
						>
							{#snippet label()}
								<span class="text-fg-secondary font-mono text-xs">{fact}</span>
							{/snippet}
						</Checkbox>
						{#if fact === report.lastError}
							<span class="text-fg-tertiary shrink-0 text-xs">last error</span>
						{/if}
					</div>
				{/each}
			{:else if problem.readFailed}
				<p class="text-fg-tertiary px-2 py-1.5 text-xs">
					Malini could not read them. The issue goes without
				</p>
			{:else}
				<p class="text-fg-tertiary px-2 py-1.5 text-xs">Reading…</p>
			{/if}
		</div>

		<p class="text-fg-tertiary text-sm">
			Opens a public issue on <span class="text-fg-secondary font-medium">bestboyhq/malini</span>
			{#if login}
				as <span class="text-fg-secondary font-medium">@{login}</span>{/if}. Never your code or
			chats.
		</p>

		{#if problem.failure}
			<p class="text-error-content text-sm" role="alert">Not filed. {problem.failure}</p>
		{/if}

		<div class="flex items-center justify-end gap-2">
			<p class="text-fg-tertiary mr-auto text-sm">
				Rather talk?
				<Button
					bare
					class="text-fg-secondary hover:text-fg-default cursor-pointer underline underline-offset-2"
					onclick={() => openExternalUrlCommand(DISCORD_URL)}
				>
					Join the Discord
				</Button>
			</p>
			<Button variant="secondary" bordered disabled={problem.filing} onclick={ondismiss}>
				Cancel
			</Button>
			<Button
				variant="primary"
				disabled={empty || problem.filing}
				ariaBusy={problem.filing}
				onclick={() => fileProblemCommand(text, kept)}
			>
				{problem.filing ? 'Filing…' : 'File issue'}
			</Button>
		</div>
	</div>
{/if}
