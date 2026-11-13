<script lang="ts">
	import { Modal } from '$hyper-ui/components/modal';
	import { closeProblemReportCommand } from '$lib/app/application/commands/close-problem-report.command';
	import { problemReportQuery } from '$lib/app/application/queries/problem-report.query.svelte';
	import ProblemReportForm from './ProblemReportForm.svelte';

	const problem = $derived(problemReportQuery.data);
</script>

<Modal
	open={problem.open}
	placement="top"
	ariaLabel="Report a problem"
	closeDisabled={problem.filing}
	closeOnBackdrop={!problem.filing}
	onclose={closeProblemReportCommand}
	navigationTarget="problem-report"
	class="w-[min(540px,calc(100vw_-_4rem))] overflow-hidden rounded-[32px]"
	contentClass="bg-surface-root p-2"
>
	{#snippet children(dismiss)}
		<ProblemReportForm ondismiss={dismiss} />
	{/snippet}
</Modal>
