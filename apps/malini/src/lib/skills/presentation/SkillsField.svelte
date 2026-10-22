<script lang="ts">
	import { onMount } from 'svelte';
	import { Autocomplete } from '$hyper-ui/components/autocomplete';
	import { ensureSkillCatalogCommand } from '$lib/skills/application/commands/ensure-skill-catalog.command';
	import { skillCatalogQuery } from '$lib/skills/application/queries/skill-catalog.query.svelte';
	import { formatTokens, skillTokens } from '$lib/skills/domain/skill-groups';

	interface Props {
		value: readonly string[];
		onchange: (skills: string[]) => void;
	}

	let { value, onchange }: Props = $props();

	const catalog = $derived(skillCatalogQuery.data(null));
	const options = $derived(
		catalog.skills.map((skill) => ({
			value: skill.name,
			label: skill.name,
			hint: formatTokens(skill.tokens),
		})),
	);
	const hint = $derived(
		value.length === 0
			? "The job's agent loads every skill that is on. Add skills to load only those."
			: `The job's agent loads only these, ${formatTokens(skillTokens(catalog.skills, value))}`,
	);

	onMount(() => ensureSkillCatalogCommand(null));
</script>

<Autocomplete
	label="Skills"
	values={[...value]}
	{options}
	placeholder={value.length === 0 ? 'Every skill that is on' : 'Add a skill'}
	{hint}
	{onchange}
/>
