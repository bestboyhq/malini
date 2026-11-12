<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { GUTTER_ROW_CLASS } from '$shared/extensions/inspector-gutter-row';
	import {
		AUTOMATIONS_ACTIVITY_HREF,
		automationHref,
		workstreamHref,
	} from '$shared/router/routes-hrefs';
	import { asksYou, type LiveAutomation } from '$lib/automations/domain/live-automations';
	import { UNRUN_QUESTION_TITLE } from '$lib/automations/domain/reconciler';
	import { automationPlace } from './automation-place';
	import { AUTOMATION_RUN_STATUS } from './automation-run-status';
	import { automationQuestionReason } from './live-automations-summary';

	interface Props {
		entries: readonly LiveAutomation[];
		workstreamId: string;
	}

	let { entries, workstreamId }: Props = $props();

	function rowOf(entry: LiveAutomation) {
		const { run, question } = entry;
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
				question === null && run?.workstreamId && run.sessionId
					? workstreamHref(run.workstreamId, { agentSessionId: run.sessionId })
					: entry.workstreamId
						? workstreamHref(entry.workstreamId)
						: run
							? automationHref(run.definitionId)
							: AUTOMATIONS_ACTIVITY_HREF,
		};
	}
</script>

<ul aria-label="Automations" class="flex flex-col">
	{#each entries as entry (entry.key)}
		{@const row = rowOf(entry)}
		<li class="flex">
			<Button
				bare
				href={row.href}
				ariaLabel={row.name}
				class={[GUTTER_ROW_CLASS, 'text-fg-secondary min-w-0 flex-1']}
				data-automation-key={entry.key}
			>
				<span
					class={['grid h-4 w-4 shrink-0 place-items-center', row.look.tone]}
					aria-hidden="true"
				>
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
			</Button>
		</li>
	{/each}
</ul>
