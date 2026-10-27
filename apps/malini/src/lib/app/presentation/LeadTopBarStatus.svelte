<script lang="ts">
	import { onDestroy } from 'svelte';
	import { leadProgressQuery } from '$lib/app/application/queries/lead-progress.query.svelte';
	import { leadHeadline, progressLabel } from '$lib/app/domain/lead-progress';
	import { activeSessionQuery } from '$lib/chat/application/queries/active-session.query.svelte';
	import { runShippingJobCommand } from '$lib/jobs/application/commands/run-shipping-job.command';
	import {
		globalTopBarGithubStatus,
		type GlobalTopBarStatusAction,
	} from '$shared/shell/global-topbar-actions.svelte';

	interface Props {
		leadId: string;
	}

	let { leadId }: Props = $props();

	const SHIP_ACTIONS = {
		'open-draft': {
			label: 'Draft all',
			ariaLabel: 'Open draft pull requests in',
			tone: 'secondary',
			icon: 'pr-draft',
		},
		merge: { label: 'Merge all', ariaLabel: 'Merge', tone: 'primary', icon: 'pr-merged' },
	} as const;

	const dots = $derived(leadProgressQuery.dots(leadId));
	const targets = $derived(leadProgressQuery.shipTargets(leadId));

	$effect(() => {
		globalTopBarGithubStatus.publish(leadId, {
			reference: null,
			title: null,
			branch: null,
			checks: [],
			checksSummary: '',
			review: null,
			todos: null,
			headline: { ...leadHeadline(dots), tooltip: dots.length > 0 ? progressLabel(dots) : null },
			action: shipAction('merge', targets.merge),
			secondaryAction: shipAction('open-draft', targets.draft),
		});
	});

	onDestroy(() => globalTopBarGithubStatus.clear(leadId));

	function shipAction(
		builtin: keyof typeof SHIP_ACTIONS,
		workstreamIds: readonly string[],
	): GlobalTopBarStatusAction | null {
		if (workstreamIds.length === 0) return null;
		const { ariaLabel, ...shown } = SHIP_ACTIONS[builtin];
		const count = workstreamIds.length;
		return {
			...shown,
			ariaLabel: `${ariaLabel} ${count} ${count === 1 ? 'workstream' : 'workstreams'}`,
			disabled: false,
			onInvoke: () => runShippingJobCommand(builtin, workstreamIds, activeSessionQuery.data),
		};
	}
</script>
