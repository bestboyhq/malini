<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import {
		DEFAULT_APPEARANCE,
		THEME_MODES,
		matchingPreset,
		type Appearance,
		type ThemeMode,
	} from '$lib/app/domain/appearance';
	import { chooseThemeModeCommand } from '$lib/app/application/commands/choose-theme-mode.command';
	import { saveLookCommand } from '$lib/app/application/commands/save-look.command';
	import { tuneAppearanceCommand } from '$lib/app/application/commands/tune-appearance.command';
	import { appearanceQuery } from '$lib/app/application/queries/appearance.query.svelte';
	import { looksQuery } from '$lib/app/application/queries/looks.query.svelte';
	import { themeModeQuery } from '$lib/app/application/queries/theme-mode.query.svelte';
	import { themeQuery } from '$lib/app/application/queries/theme.query.svelte';
	import AppearanceReadings from '../appearance/AppearanceReadings.svelte';
	import FineTune from '../appearance/FineTune.svelte';
	import GreyPresets from '../appearance/GreyPresets.svelte';
	import Levers from '../appearance/Levers.svelte';
	import LookHistory from '../appearance/LookHistory.svelte';
	import TintWheel from '../appearance/TintWheel.svelte';
	import ChoiceSwitch from './ChoiceSwitch.svelte';
	import SettingsSection from './SettingsSection.svelte';

	type Driver = 'wheel' | 'levers' | 'fine-tune' | 'presets' | 'history' | 'reset';

	const THEME_MODE_LABELS: Readonly<Record<ThemeMode, string>> = {
		system: 'System',
		light: 'Light',
		dark: 'Dark',
	};

	const appearance = $derived(appearanceQuery.data);
	const themeMode = $derived(themeModeQuery.data);
	const theme = $derived(themeQuery.data);
	const preset = $derived(matchingPreset(appearance));
	const looks = $derived(looksQuery.data);

	let driver: Driver | null = $state(null);

	onMount(() => {
		saveLookCommand();
		return saveLookCommand;
	});

	function tune(source: Driver, patch: Partial<Appearance>): void {
		driver = source;
		tuneAppearanceCommand(patch);
	}
</script>

<SettingsSection
	title="Appearance"
	description="Tune the greys Malini is made of. Every gauge drives the same values, so moving one moves the rest."
>
	{#snippet actions()}
		<Button
			variant="secondary"
			size="md"
			radius="full"
			bordered
			onclick={() => tune('reset', DEFAULT_APPEARANCE)}
		>
			Reset to default
		</Button>
	{/snippet}

	<div class="flex flex-col gap-1.5">
		<Well title="Theme" note={themeMode === 'system' ? theme : undefined}>
			{#snippet trailing()}
				<ChoiceSwitch
					label="Theme"
					choices={THEME_MODES}
					labels={THEME_MODE_LABELS}
					selected={themeMode}
					onchoose={chooseThemeModeCommand}
				/>
			{/snippet}
		</Well>

		<Well title="Gauges">
			<div class="grid grid-cols-[repeat(2,minmax(min-content,1fr))] gap-1.5">
				<TintWheel
					{appearance}
					driving={driver === 'wheel'}
					ontune={(patch) => tune('wheel', patch)}
				/>
				<Levers
					{appearance}
					driving={driver === 'levers'}
					ontune={(patch) => tune('levers', patch)}
				/>
				<FineTune
					class="col-span-2"
					{appearance}
					driving={driver === 'fine-tune'}
					ontune={(patch) => tune('fine-tune', patch)}
				/>
			</div>
		</Well>

		<Well title="Presets" note={preset ? preset.name.toLowerCase() : 'custom'}>
			<GreyPresets
				selected={preset}
				onchoose={(choice) => tune('presets', { hue: choice.hue, chroma: choice.chroma })}
			/>
		</Well>

		<Well title="History" note="saved on close">
			<LookHistory
				{looks}
				current={appearance}
				onchoose={(look) => tune('history', look.appearance)}
			/>
		</Well>

		<Well title="Readings" headed={false}>
			<AppearanceReadings {appearance} {theme} />
		</Well>
	</div>
</SettingsSection>
