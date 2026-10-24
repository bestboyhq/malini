<script lang="ts">
	import {
		schedulePlaceName,
		scheduleWhen,
		type ScheduleTrigger,
	} from '$contract/automation-trigger';
	import { connectedRepositoriesQuery } from '$shared/repositories/repositories.api';
	import ChoiceMenu from './ChoiceMenu.svelte';
	import { schedulePlaces, schedulePlaceValue } from './triggers';

	interface Props {
		schedule: ScheduleTrigger;
		onchange: (when: string) => void;
	}

	let { schedule, onchange }: Props = $props();

	const places = $derived(
		schedulePlaces(connectedRepositoriesQuery.data.map((repository) => repository.fullName)),
	);
	const options = $derived(
		places.map((place) => ({ value: schedulePlaceValue(place), label: schedulePlaceName(place) })),
	);

	function onPlace(value: string): void {
		const place = places.find((candidate) => schedulePlaceValue(candidate) === value);
		if (place) onchange(scheduleWhen({ ...schedule, place }));
	}
</script>

<ChoiceMenu
	value={schedulePlaceValue(schedule.place)}
	{options}
	ariaLabel="Runs in"
	icon="route"
	onchange={onPlace}
/>
