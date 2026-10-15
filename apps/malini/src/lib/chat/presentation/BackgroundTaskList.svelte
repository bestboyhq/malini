<script lang="ts">
	import { onMount } from 'svelte';
	import type { AgentBackgroundTaskKind } from '$contract/agent';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { avoidedByToasts } from '$hyper-ui/components/toast';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon, type IconName } from '$hyper-ui/icons';
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
	aria-label={`${backgroundWorkSummary(work.tasks)} running`}
	data-testid="background-tasks"
>
	<ul class="max-h-40 overflow-y-auto p-1">
		{#each work.tasks as task (task.taskId)}
			<li
				class="hover:bg-surface-50-hover flex h-7 items-center gap-2 rounded-xl pr-1 pl-2 text-xs"
				data-testid="background-task"
				data-task-kind={task.kind}
			>
				<span class="text-fg-tertiary grid w-4 shrink-0 place-items-center" aria-hidden="true">
					<Icon name={KIND_ICONS[task.kind]} size={12} />
				</span>
				<span class="text-fg-default max-w-1/2 min-w-0 truncate font-medium">
					{task.description}
				</span>
				<span
					class="text-2xs text-fg-tertiary min-w-0 flex-1 truncate font-mono"
					data-testid="background-task-output"
				>
					{task.detail ?? ''}
				</span>
				<span class="text-2xs text-fg-tertiary shrink-0 tabular-nums">
					{backgroundTaskElapsed(task.startedAt, nowMs)}
				</span>
				<Tooltip content="Stop this task" placement="top">
					<IconButton
						variant="ghost"
						size="xs"
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
