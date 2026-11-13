<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Popover } from '$hyper-ui/components/popover';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { GUTTER_ROW_CLASS } from '$shared/extensions/inspector-gutter-row';
	import {
		AUTOMATIONS_ACTIVITY_HREF,
		automationHref,
		workstreamHref,
	} from '$shared/router/routes-hrefs';
	import { asksYou, type LiveAutomation } from '$lib/automations/domain/live-automations';
	import { UNRUN_QUESTION_TITLE } from '$lib/automations/domain/reconciler';
	import AutomationQuestionRow from './AutomationQuestionRow.svelte';
	import { automationPlace } from './automation-place';
	import { AUTOMATION_RUN_STATUS } from './automation-run-status';
	import { automationQuestionReason } from './live-automations-summary';

	interface Props {
		entries: readonly LiveAutomation[];
		workstreamId: string;
	}

	let { entries, workstreamId }: Props = $props();

	let askedKey = $state<string | null>(null);
	let lastAsked = $state<LiveAutomation | null>(null);
	let list = $state<HTMLUListElement | null>(null);
	let anchor = $state<HTMLElement | null>(null);
	let at = $state({ x: 0, y: 0 });
	let nowMs = $state(Date.now());

	const asked = $derived(
		entries.find((entry) => entry.key === askedKey && answersHere(entry)) ?? null,
	);

	$effect(() => {
		if (!asked) return;
		nowMs = Date.now();
		const clock = setInterval(() => (nowMs = Date.now()), 1_000);
		return () => clearInterval(clock);
	});

	function answersHere(entry: LiveAutomation): boolean {
		return asksYou(entry) && entry.run?.status !== 'needs-you';
	}

	function ask(entry: LiveAutomation, event: MouseEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		const rect = event.currentTarget.getBoundingClientRect();
		anchor = event.currentTarget;
		at = { x: list?.getBoundingClientRect().left ?? rect.left, y: rect.bottom + 4 };
		lastAsked = entry;
		askedKey = askedKey === entry.key ? null : entry.key;
	}

	function rowOf(entry: LiveAutomation) {
		const { run } = entry;
		const asking = asksYou(entry);
		const look =
			run && (!asking || run.status === 'failed' || run.status === 'needs-you')
				? AUTOMATION_RUN_STATUS[run.status]
				: AUTOMATION_RUN_STATUS.waiting;
		const title = run?.title ?? UNRUN_QUESTION_TITLE;
		const place = automationPlace(run, entry.workstreamId);
		const state = asking ? automationQuestionReason(entry) : look.label;
		return {
			title,
			state,
			look,
			asking,
			running: !asking && run?.status === 'running',
			name: `${title}${entry.workstreamId !== workstreamId && place ? ` in ${place}` : ''}, ${state}`,
			href:
				run?.workstreamId && run.sessionId
					? workstreamHref(run.workstreamId, { agentSessionId: run.sessionId })
					: run
						? automationHref(run.definitionId)
						: AUTOMATIONS_ACTIVITY_HREF,
		};
	}
</script>

{#snippet line(row: ReturnType<typeof rowOf>)}
	<span class={['grid h-4 w-4 shrink-0 place-items-center', row.look.tone]} aria-hidden="true">
		{#if row.running}
			<BusyIcon size={12} />
		{:else}
			<Icon name={row.look.icon} size={13} />
		{/if}
	</span>
	<span class="min-w-0 flex-1 truncate">{row.title}</span>
	<span
		class={['text-2xs shrink-0', row.asking ? 'text-brand-foreground' : 'text-fg-tertiary']}
		aria-hidden="true"
	>
		{row.state}
	</span>
{/snippet}

<ul bind:this={list} aria-label="Automations" class="flex flex-col px-1.5">
	{#each entries as entry (entry.key)}
		{@const row = rowOf(entry)}
		<li class="flex">
			{#if answersHere(entry)}
				<Button
					bare
					ariaLabel={row.name}
					ariaHasPopup="dialog"
					ariaExpanded={asked?.key === entry.key}
					class={[GUTTER_ROW_CLASS, 'text-fg-secondary min-w-0 flex-1']}
					data-automation-key={entry.key}
					onclick={(event) => ask(entry, event)}
				>
					{@render line(row)}
				</Button>
			{:else}
				<Button
					bare
					href={row.href}
					ariaLabel={row.name}
					class={[GUTTER_ROW_CLASS, 'text-fg-secondary min-w-0 flex-1']}
					data-automation-key={entry.key}
				>
					{@render line(row)}
				</Button>
			{/if}
		</li>
	{/each}
</ul>

<Popover
	open={asked !== null}
	x={at.x}
	y={at.y}
	{anchor}
	onclose={() => (askedKey = null)}
	label={lastAsked ? rowOf(lastAsked).name : 'Automation'}
	panelClass="w-72 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1"
	owner="automation-question"
>
	{#snippet children()}
		{@const shown = asked ?? lastAsked}
		{#if shown}
			<AutomationQuestionRow entry={shown} {nowMs} shownIn={workstreamId} />
		{/if}
	{/snippet}
</Popover>
