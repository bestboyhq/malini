<script lang="ts">
	import { onMount } from 'svelte';
	import type { JobDefinitionRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { LoadingCircle } from '$hyper-ui/components/loading-circle';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Icon } from '$hyper-ui/icons';
	import { JOBS_HREF } from '$shared/router/routes-hrefs';
	import { loadJobsCommand } from '$lib/jobs/application/commands/load-jobs.command';
	import { runJobCommand } from '$lib/jobs/application/commands/run-job.command';
	import { watchJobsHook } from '$lib/jobs/application/hooks/watch-jobs.hook';
	import { builtinJobDefinitionsQuery } from '$lib/jobs/application/queries/builtin-job-definitions.query.svelte';
	import { customJobDefinitionsQuery } from '$lib/jobs/application/queries/custom-job-definitions.query.svelte';
	import { jobActionStateQuery } from '$lib/jobs/application/queries/job-action-state.query.svelte';
	import { jobsLoadQuery } from '$lib/jobs/application/queries/jobs-load.query.svelte';
	import { isRunnableJob } from '$lib/jobs/domain/builtin-jobs';
	import { instructionsPreview } from './job-definition-copy';

	interface Props {
		anchor: HTMLElement | null;
		openedByTyping: boolean;
		workstreamId: string;
		chatSessionId: string | null;
		chatAfterRunId: string | null;
		onclose: (restore: string) => void;
	}

	let { anchor, openedByTyping, workstreamId, chatSessionId, chatAfterRunId, onclose }: Props =
		$props();

	let query = $state('');
	let selectedIndex = $state(0);
	let searchEl: HTMLInputElement | null = $state(null);
	let startedId = $state<string | null>(null);

	const builtins = $derived(builtinJobDefinitionsQuery.data);
	const customs = $derived(customJobDefinitionsQuery.data);
	const load = $derived(jobsLoadQuery.data);
	const actionState = $derived(jobActionStateQuery.data);
	const jobs = $derived([...builtins, ...customs].filter(isRunnableJob));
	const matches = $derived.by(() => {
		const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
		return jobs.filter((job) => terms.every((term) => job.name.toLowerCase().includes(term)));
	});
	const started = $derived(startedId === null ? null : actionState(startedId));

	onMount(() => {
		loadJobsCommand();
		return watchJobsHook();
	});

	$effect(() => {
		searchEl?.focus();
	});

	$effect(() => {
		if (started === null || started.busy || started.error !== null) return;
		onclose('');
	});

	function run(job: JobDefinitionRecord): void {
		if (started?.busy) return;
		startedId = job.id;
		runJobCommand({
			definitionId: job.id,
			workstreamId,
			...(chatSessionId === null
				? {}
				: { chatSessionId, ...(chatAfterRunId ? { chatAfterRunId } : {}) }),
		});
	}

	function dismiss(): void {
		onclose(openedByTyping ? `/${query}` : '');
	}

	function onSearchKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			dismiss();
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			selectedIndex = Math.min(Math.max(selectedIndex + step, 0), Math.max(0, matches.length - 1));
			return;
		}
		if (event.key === 'Enter') {
			const selected = matches[selectedIndex];
			if (!selected) return;
			event.preventDefault();
			run(selected);
			return;
		}
		if (!openedByTyping) return;
		if (event.key === ' ' && (query.trim() === '' || matches.length === 0)) {
			event.preventDefault();
			onclose(`/${query} `);
			return;
		}
		if (event.key === 'Backspace' && query === '') {
			event.preventDefault();
			onclose('');
		}
	}
</script>

<DropdownLayer
	open
	{anchor}
	onclose={dismiss}
	side="top"
	align="start"
	panelClass="w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated"
	testId="job-picker"
	owner="chat-composer"
	restoreFocusToAnchor={false}
>
	<div role="dialog" aria-label="Run a job">
		<div class="border-surface-elevated-border flex items-center gap-2 border-b px-3 py-2.5">
			<Icon name="checklist" class="text-fg-tertiary shrink-0" size={16} />
			<TextInput
				bind:element={searchEl}
				bind:value={query}
				bare
				type="search"
				placeholder="Find a job"
				ariaLabel="Find a job"
				class="h-7 min-w-0 flex-1 text-sm"
				inputClass="[&::-webkit-search-cancel-button]:hidden"
				oninput={() => (selectedIndex = 0)}
				onkeydown={onSearchKeydown}
			/>
			<kbd
				class="border-chip-border bg-chip text-2xs text-fg-tertiary rounded border px-1.5 py-0.5"
			>
				esc
			</kbd>
		</div>
		{#if matches.length > 0}
			<div class="styled-scrollbar max-h-72 overflow-y-auto p-1.5" role="listbox" aria-label="Jobs">
				{#each matches as job, index (job.id)}
					<DropdownItem
						role="option"
						aria-selected={index === selectedIndex}
						selected={index === selectedIndex}
						focusOnHover={false}
						class="w-full gap-2.5 px-2.5 py-2 text-left"
						onmouseenter={() => (selectedIndex = index)}
						onclick={() => run(job)}
					>
						<span class="text-fg-tertiary grid size-4 shrink-0 place-items-center">
							{#if startedId === job.id && started?.busy}
								<LoadingCircle size={12} />
							{:else}
								<Icon name="play" size={12} />
							{/if}
						</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-xs font-medium">{job.name}</span>
							<span class="text-2xs text-fg-tertiary mt-0.5 block truncate">
								{instructionsPreview(job.instructions)}
							</span>
						</span>
					</DropdownItem>
				{/each}
			</div>
		{:else}
			<p class="text-fg-tertiary flex items-center gap-2 px-4 py-3 text-xs" role="status">
				{#if load.state === 'loading'}
					<LoadingCircle size={12} />
					Loading jobs…
				{:else if load.error}
					{load.error}
				{:else if query.trim()}
					No job matches “{query.trim()}”
				{:else}
					No jobs yet
				{/if}
			</p>
		{/if}
		{#if started?.error}
			<p
				class="text-2xs text-error-content border-surface-elevated-border flex items-start gap-1.5 border-t px-3 py-2 leading-4"
				role="alert"
			>
				<Icon name="alert" class="mt-px shrink-0" size={13} />
				<span class="min-w-0">{started.error}</span>
			</p>
		{/if}
		<div
			class="border-surface-elevated-border flex items-center justify-end border-t px-1.5 py-1.5"
		>
			<Button variant="ghost" size="sm" href={JOBS_HREF}>Manage jobs</Button>
		</div>
	</div>
</DropdownLayer>
