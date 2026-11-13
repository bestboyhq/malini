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
	title="Report a problem"
	description="Simon reads every one. Usually the same day"
	closeDisabled={problem.filing}
	closeOnBackdrop={!problem.filing}
	onclose={closeProblemReportCommand}
	navigationTarget="problem-report"
>
	{#snippet children(dismiss)}
		<ProblemReportForm ondismiss={dismiss} />
	{/snippet}
</Modal>
