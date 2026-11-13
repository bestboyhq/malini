<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Switch } from '$hyper-ui/components/switch';
	import { Textarea } from '$hyper-ui/components/textarea';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Well } from '$hyper-ui/components/well';
	import { Icon } from '$hyper-ui/icons';
	import { githubAuthQuery } from '$shared/repositories/repositories.api';
	import { DISCORD_URL, PROBLEM_TEXT_LIMIT } from '$lib/app/domain/problem-report';
	import { fileProblemCommand } from '$lib/app/application/commands/file-problem.command';
	import { openExternalUrlCommand } from '$lib/app/application/commands/open-external-url.command';
	import { problemReportQuery } from '$lib/app/application/queries/problem-report.query.svelte';

	interface Props {
		ondismiss: () => void;
	}

	type Fact = Readonly<{ label: string; value: string }>;

	let { ondismiss }: Props = $props();

	const uid = $props.id();
	const problem = $derived(problemReportQuery.data);
	const login = $derived(githubAuthQuery.data?.login ?? null);
	const report = $derived(problem.report);
	const facts: readonly Fact[] = $derived(
		report
			? [
					{ label: 'Versions', value: report.system },
					{ label: 'So far', value: report.journey },
					{ label: 'Last error', value: report.lastError },
				].filter((fact): fact is Fact => fact.value !== null)
			: [],
	);

	let text: string = $state('');
	let dropped: readonly string[] = $state([]);

	const kept = $derived(
		facts.map((fact) => fact.value).filter((value) => !dropped.includes(value)),
	);
	const empty = $derived(text.trim() === '');

	function onKeep(value: string, keep: boolean): void {
		dropped = keep ? dropped.filter((other) => other !== value) : [...dropped, value];
	}
</script>

<div class="bg-surface-50 border-surface-50-border relative rounded-3xl border-[0.5px]">
	<div class="absolute top-5 right-4.5">
		<Tooltip content="Close" placement="bottom">
			<IconButton
				variant="ghost"
				size="sm"
				ariaLabel="Close"
				ariaKeyshortcuts="Escape"
				disabled={problem.filing}
				onclick={ondismiss}
			>
				<Icon name="close" size={16} />
			</IconButton>
		</Tooltip>
	</div>

	<div class="mr-12.5 mb-3 ml-4.5 pt-4">
		<h2 class="text-fg-default text-xl font-semibold tracking-tight">Report a problem</h2>
		<p class="text-fg-tertiary mt-0.5 text-xs">Simon reads every one. Usually the same day</p>
	</div>

	<div class="flex flex-col gap-1.5 px-1.5 pb-1.5">
		{#if problem.filed}
			{@const filed = problem.filed}
			<Well title="Filed" headed={false}>
				<div
					class="border-surface-50-border bg-surface-50 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl border-[0.5px] px-4 py-3"
				>
					<span
						class="bg-success-content/12 text-success-content grid size-7 place-items-center rounded-full"
					>
						<Icon name="check" size={15} />
					</span>
					<div class="min-w-0">
						<h3 class="text-fg-default text-sm font-medium">Filed as #{filed.number}</h3>
						<p class="text-fg-tertiary text-xs">Replies show up on GitHub</p>
					</div>
					<Button
						variant="secondary"
						radius="full"
						bordered
						onclick={() => openExternalUrlCommand(filed.url)}
					>
						Open on GitHub
					</Button>
				</div>
			</Well>
		{:else}
			<Well title="What broke" headed={false}>
				<div
					class="border-surface-50-border bg-surface-50 focus-within:border-border-default rounded-xl border-[0.5px] transition-[border-color]"
				>
					<Textarea
						bare
						bind:value={text}
						rows={4}
						ariaLabel="What broke"
						placeholder="What broke, and what you expected"
						maxlength={PROBLEM_TEXT_LIMIT}
						disabled={problem.filing}
						textareaClass="px-4 py-3 text-sm leading-5"
					/>
				</div>
			</Well>

			<Well title="Goes with it">
				<div
					class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]"
				>
					{#each facts as fact, index (fact.value)}
						{@const id = `${uid}-${index}`}
						<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3">
							<div class="min-w-0">
								<h4 id="{id}-label" class="text-fg-default text-sm font-medium">{fact.label}</h4>
								<p id="{id}-value" class="text-fg-tertiary text-xs break-words">{fact.value}</p>
							</div>
							<Switch
								size="sm"
								checked={!dropped.includes(fact.value)}
								disabled={problem.filing}
								labelledBy="{id}-label {id}-value"
								onchange={(keep) => onKeep(fact.value, keep)}
							/>
						</div>
					{:else}
						<p class="text-fg-tertiary px-4 py-3 text-xs">
							{problem.readFailed
								? 'Malini could not read them. The issue goes without'
								: 'Reading…'}
						</p>
					{/each}
				</div>
			</Well>

			<p class="text-fg-tertiary px-3 pt-1 pb-1.5 text-xs text-pretty">
				Opens a public issue on <span class="text-fg-secondary font-medium">bestboyhq/malini</span>
				{#if login}
					as <span class="text-fg-secondary font-medium">@{login}</span>{/if}. Never your code or
				chats.
			</p>
		{/if}
	</div>
</div>

{#if problem.failure && !problem.filed}
	<p class="text-error-content px-3 pt-2.5 text-xs" role="alert">Not filed. {problem.failure}</p>
{/if}

<div class="flex items-center gap-2 pt-2 pr-1 pb-1 pl-3">
	{#if problem.filed}
		<Button variant="primary" radius="full" class="ml-auto" onclick={ondismiss}>Done</Button>
	{:else}
		<p class="text-fg-tertiary mr-auto text-xs">
			Rather talk?
			<Button
				bare
				class="text-fg-default cursor-pointer text-xs hover:underline"
				onclick={() => openExternalUrlCommand(DISCORD_URL)}
			>
				Join the Discord
			</Button>
		</p>
		<Button
			variant="secondary"
			radius="full"
			bordered
			disabled={problem.filing}
			onclick={ondismiss}
		>
			Cancel
		</Button>
		<Button
			variant="primary"
			radius="full"
			disabled={empty || problem.filing}
			ariaBusy={problem.filing}
			onclick={() => fileProblemCommand(text, kept)}
		>
			{problem.filing ? 'Filing…' : 'File issue'}
		</Button>
	{/if}
</div>
