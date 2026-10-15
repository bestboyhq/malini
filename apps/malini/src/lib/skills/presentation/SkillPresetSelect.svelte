<script lang="ts">
	import { onMount } from 'svelte';
	import { Select, type SelectOption } from '$hyper-ui/components/select';
	import { loadSkillPresetsCommand } from '$lib/skills/application/commands/load-skill-presets.command';
	import { skillPresetsQuery } from '$lib/skills/application/queries/skill-presets.query.svelte';

	const INHERIT = '';

	interface Props {
		value: string | null;
		label?: string;
		onchange: (presetId: string | null) => void;
	}

	let { value, label = 'Skills', onchange }: Props = $props();

	const presets = $derived(skillPresetsQuery.data);
	const options: SelectOption[] = $derived([
		{ value: INHERIT, label: 'Same as the workstream' },
		...presets.map((preset) => ({
			value: preset.id,
			label: `${preset.name} · ${preset.skills.length} ${preset.skills.length === 1 ? 'skill' : 'skills'}`,
		})),
	]);
	const known = $derived(value !== null && presets.some(({ id }) => id === value));

	onMount(loadSkillPresetsCommand);
</script>

<Select
	value={known && value !== null ? value : INHERIT}
	{label}
	{options}
	hint="The skills the job's agent can load."
	onchange={(next) => onchange(next === INHERIT ? null : next)}
/>
