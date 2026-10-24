<script lang="ts">
	import { repositoryContextQuery } from '$shared/repositories/application/queries/repository-context.query.svelte';
	import { workstreamByIdQuery } from '$shared/repositories/application/queries/workstream-by-id.query.svelte';
	import { leadScopeLabel } from '$shared/repositories/domain/lead-scope';

	interface Props {
		workstreamId: string;
	}

	let { workstreamId }: Props = $props();

	const repositoryContext = $derived(repositoryContextQuery.data(workstreamId));
	const scope = $derived(workstreamByIdQuery.data(workstreamId)?.scope ?? null);
	const label = $derived(
		repositoryContext?.repo.fullName ?? (scope ? leadScopeLabel(scope) : 'Workstream'),
	);
</script>

<svelte:head>
	<title>Malini · {label}</title>
</svelte:head>
