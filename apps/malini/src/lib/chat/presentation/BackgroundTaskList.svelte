<script lang="ts">
	import { onMount } from 'svelte';
	import type { AgentBackgroundTaskKind } from '$contract/agent';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { avoidedByToasts } from '$hyper-ui/components/toast';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BusyIcon, Icon, type IconName } from '$hyper-ui/icons';
	import {
		backgroundTaskElapsed,
		backgroundWorkSummary,
		type BackgroundWork,
	} from '$lib/chat/domain/background-work';

	interface Props {
		work: BackgroundWork;
		onstop: (taskId: string) => void;
	}

	let { work, onstop }: Props = $props();

	const KIND_ICONS: Readonly<Record<AgentBackgroundTaskKind, IconName>> = {
		command: 'terminal',
		agent: 'sparkles',
		task: 'circle-dot',
	};

	let nowMs = $state(Date.now());
	let stopping = $state<ReadonlySet<string>>(new Set());

	onMount(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 1_000);
		return () => clearInterval(clock);
	});

	function stop(taskId: string): void {
		stopping = new Set([...stopping, taskId]);
		onstop(taskId);
	}
</script>

<section
	{@attach avoidedByToasts}
	aria-label={`Background work (${work.tasks.length})`}
	data-testid="background-tasks"
>
	<header class="text-fg-secondary flex h-8 items-center gap-2 px-3 text-xs">
		<span class="text-fg-tertiary grid w-4 shrink-0 place-items-center" aria-hidden="true">
			<BusyIcon size={12} />
		</span>
		<span class="min-w-0 flex-1 truncate" data-testid="background-tasks-count">
			{backgroundWorkSummary(work.tasks)} running
		</span>
		{#if work.waiting}
			<span class="text-2xs text-fg-tertiary shrink-0">The agent resumes when they finish</span>
		{/if}
	</header>

	<ul class="max-h-48 overflow-y-auto px-1 pb-1">
		{#each work.tasks as task (task.taskId)}
			<li
				class="hover:bg-surface-50-hover flex min-h-8 items-center gap-2 rounded-lg px-2 py-1"
				data-testid="background-task"
				data-task-kind={task.kind}
			>
				<span class="text-fg-tertiary grid w-4 shrink-0 place-items-center" aria-hidden="true">
					<Icon name={KIND_ICONS[task.kind]} size={12} />
				</span>
				<div class="min-w-0 flex-1 leading-4">
					<p class="text-fg-secondary truncate text-xs">{task.description}</p>
					{#if task.detail}
						<p
							class="text-2xs text-fg-tertiary truncate font-mono"
							data-testid="background-task-output"
						>
							{task.detail}
						</p>
					{/if}
				</div>
				<span class="text-2xs text-fg-tertiary shrink-0 tabular-nums">
					{backgroundTaskElapsed(task.startedAt, nowMs)}
				</span>
				<Tooltip content="Stop this task" placement="top">
					<IconButton
						variant="ghost"
						size="sm"
						class="text-fg-tertiary"
						ariaLabel={`Stop ${task.description}`}
						disabled={stopping.has(task.taskId)}
						onclick={() => stop(task.taskId)}
					>
						<Icon name="stop" size={12} />
					</IconButton>
				</Tooltip>
			</li>
		{/each}
	</ul>
</section>
