<script lang="ts">
	import { repositoryContextQuery } from '$shared/repositories/application/queries/repository-context.query.svelte';

	interface Props {
		workstreamId: string;
	}

	let { workstreamId }: Props = $props();

	const repositoryContext = $derived(repositoryContextQuery.data(workstreamId));
	const label = $derived(repositoryContext?.repo.fullName ?? 'Workstream');
</script>

<svelte:head>
	<title>malini · {label}</title>
</svelte:head>
