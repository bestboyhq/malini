<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Badge } from '$hyper-ui/components/badge';
	import { Button } from '$hyper-ui/components/button';
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Icon } from '$hyper-ui/icons';
	import { createRovingFocus } from '$hyper-ui/overlay';
	import {
		effortsForModel,
		filterPickerRows,
		pickerRows,
		rowRunner,
		rowRuns,
		runs,
		selectionLabel,
		selectionModels,
		type PickerRow,
		type PickerRunner,
	} from '$shared/providers/domain/model-catalog';
	import type { ClaudeCodeFailedUpdate } from '$contract/agent';
	import { goto } from '$shared/router/navigation';
	import { PROVIDER_SETTINGS_HREF } from '$shared/router/routes-hrefs';
	import { usesSubscription } from '$shared/providers/domain/claude-code-status';
	import {
		CLAUDE_PROVIDER_ID,
		isModelAccessReady,
		modelAccess,
	} from '$shared/providers/domain/provider';
	import {
		sameModelPreset,
		type ModelPreset,
		type ModelSelection,
	} from '$shared/providers/domain/model-preferences';
	import {
		reasoningEffortLabel,
		type AgentReasoningEffort,
	} from '$shared/providers/domain/run-profile';
	import { loadModelProvidersCommand } from '$shared/providers/application/commands/load-model-providers.command';
	import { loadProviderCapabilitiesCommand } from '$shared/providers/application/commands/load-provider-capabilities.command';
	import { refreshModelProvidersCommand } from '$shared/providers/application/commands/refresh-model-providers.command';
	import { toggleModelPresetCommand } from '$shared/providers/application/commands/toggle-model-preset.command';
	import { providerGroupsQuery } from '$shared/providers/application/queries/provider-groups.query.svelte';
	import { claudeCodeStatusQuery } from '$shared/providers/application/queries/claude-code-status.query.svelte';
	import { claudeCodeUpdateQuery } from '$shared/providers/application/queries/claude-code-update.query.svelte';
	import { modelPresetsQuery } from '$shared/providers/application/queries/model-presets.query.svelte';
	import ProviderIcon from './ProviderIcon.svelte';

	interface Props {
		selection: ModelSelection;
		effort: AgentReasoningEffort;
		disabled?: boolean;
		onchange: (selection: ModelSelection, effort?: AgentReasoningEffort) => void;
	}

	interface Flyout {
		readonly row: PickerRow;
		readonly anchor: HTMLElement;
	}

	const FLYOUT_OPEN_MS = 80;
	const FLYOUT_SWITCH_MS = 200;

	let { selection, effort, disabled = false, onchange }: Props = $props();
	let open = $state(false);
	let query = $state('');
	let filterInput = $state<HTMLInputElement | null>(null);
	let list = $state<HTMLElement | null>(null);
	let flyout = $state<Flyout | null>(null);
	let flyoutContent = $state<HTMLElement | null>(null);
	let hoverTimer: ReturnType<typeof setTimeout> | undefined;

	const groups = $derived(providerGroupsQuery.data);
	const claudeStatus = $derived(claudeCodeStatusQuery.data);
	const failedUpdate = $derived(
		claudeStatus.kind === 'ready' ? claudeCodeUpdateQuery.data.failed : null,
	);
	const rows = $derived(filterPickerRows(pickerRows(groups, selection), query));
	const selectedLabel = $derived(selectionLabel(groups, selection));
	const currentPreset: ModelPreset = $derived({
		selection,
		effort:
			effortsForModel(selectionModels(groups, selection), selection.model).length > 0
				? effort
				: null,
	});
	const presets = $derived(
		modelPresetsQuery.data.filter((preset) => rows.some((row) => rowRuns(row, preset.selection))),
	);
	const currentSaved = $derived(
		modelPresetsQuery.data.some((preset) => sameModelPreset(preset, currentPreset)),
	);
	const flyoutFocus = createRovingFocus({ container: () => flyoutContent });

	function ready(runner: PickerRunner): boolean {
		const access = modelAccess(
			{ provider: runner.group.id, model: runner.model.id },
			groups,
			claudeStatus,
		);
		return isModelAccessReady(access);
	}

	function runnerNote(runner: PickerRunner): string {
		if (runner.group.kind === 'chatgpt') {
			return runner.group.ready ? 'Your ChatGPT plan' : 'Needs a sign-in';
		}
		if (runner.group.id !== CLAUDE_PROVIDER_ID) {
			return runner.group.ready ? 'Key saved' : 'Needs a key';
		}
		switch (claudeStatus.kind) {
			case 'ready':
				return usesSubscription(claudeStatus) ? 'Your Claude plan' : 'Signed in';
			case 'signed-out':
				return 'Needs a sign-in';
			case 'missing':
				return 'Needs Claude Code';
			case 'checking':
				return 'Checking';
			case 'unknown':
				return "Couldn't check";
		}
	}

	function presetName(preset: ModelPreset): string {
		const label = selectionLabel(groups, preset.selection);
		return preset.effort ? `${label} · ${reasoningEffortLabel(preset.effort)}` : label;
	}

	function select(runner: PickerRunner): void {
		flyout?.anchor.focus({ preventScroll: true });
		closeFlyout();
		open = false;
		if (!runs(runner, selection)) onchange({ provider: runner.group.id, model: runner.model.id });
	}

	function applyPreset(preset: ModelPreset): void {
		open = false;
		onchange({ ...preset.selection }, preset.effort ?? undefined);
	}

	function closeFlyout(): void {
		clearTimeout(hoverTimer);
		flyout = null;
	}

	function hover(row: PickerRow, anchor: HTMLElement): void {
		clearTimeout(hoverTimer);
		const next = row.runners.length > 1 ? { row, anchor } : null;
		if (next?.row.family === flyout?.row.family) return;
		hoverTimer = setTimeout(() => (flyout = next), flyout ? FLYOUT_SWITCH_MS : FLYOUT_OPEN_MS);
	}

	async function openFlyout(row: PickerRow, anchor: HTMLElement): Promise<void> {
		clearTimeout(hoverTimer);
		flyout = { row, anchor };
		await tick();
		flyoutContent?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
	}

	function onRowKeydown(event: KeyboardEvent, row: PickerRow): void {
		if (event.key !== 'ArrowRight' || row.runners.length < 2) return;
		event.preventDefault();
		if (event.currentTarget instanceof HTMLElement) void openFlyout(row, event.currentTarget);
	}

	function onFlyoutKeydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowLeft' || event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			const anchor = flyout?.anchor;
			closeFlyout();
			anchor?.focus({ preventScroll: true });
			return;
		}
		if (flyoutFocus.handleArrowKeys(event)) event.stopPropagation();
	}

	function onListFocus(event: FocusEvent): void {
		if (!(event.target instanceof HTMLElement) || !event.target.matches(':focus-visible')) return;
		event.target.scrollIntoView({ block: 'nearest' });
		if (flyout && event.target !== flyout.anchor) closeFlyout();
	}

	async function revealSelection(): Promise<void> {
		await tick();
		list
			?.querySelector('[data-testid="chat-model-option"][aria-selected="true"]')
			?.scrollIntoView({ block: 'nearest' });
	}

	function failedUpdateLabel(update: ClaudeCodeFailedUpdate): string {
		return update.version ? `Claude Code ${update.version} is out` : 'A Claude Code update is out';
	}

	function onOpenChange(nextOpen: boolean): void {
		open = nextOpen;
		query = '';
		closeFlyout();
		if (nextOpen) {
			loadProviderCapabilitiesCommand('stale');
			refreshModelProvidersCommand();
			queueMicrotask(() => filterInput?.focus());
			void revealSelection();
		}
	}

	function onFilterKeydown(event: KeyboardEvent): void {
		if (event.key === 'Home' || event.key === 'End') event.stopPropagation();
		if (event.key !== 'Enter' || event.isComposing) return;
		event.preventDefault();
		const first = rows[0];
		if (first) select(rowRunner(first, selection, ready));
	}

	onMount(() => {
		loadProviderCapabilitiesCommand();
		loadModelProvidersCommand();
		return () => clearTimeout(hoverTimer);
	});
</script>

<div class="flex min-w-0">
	<Dropdown
		bind:open
		side="top"
		align="start"
		{onOpenChange}
		panelClass="w-80"
		contentClass="flex max-h-[min(30rem,60vh)] flex-col overflow-hidden"
		testId="chat-model-picker"
		owner="chat-composer"
	>
		{#snippet trigger()}
			<Button
				variant="ghost"
				size="auto"
				active={open}
				ariaLabel={`Model: ${selectedLabel}`}
				ariaHasPopup="listbox"
				ariaExpanded={open}
				{disabled}
				class="text-fg-secondary hover:bg-surface-50 h-6 max-w-[min(10rem,100%)] min-w-0 gap-1.5 overflow-hidden rounded-md px-2 text-xs font-normal"
				data-testid="chat-composer-model"
			>
				<ProviderIcon
					providerId={selection.provider}
					class="text-fg-secondary shrink-0"
					size={13}
				/>
				<span class="truncate">{selectedLabel}</span>
				<Icon
					name="chevron-down"
					class={['shrink-0 transition-transform duration-150', !open && 'rotate-180']}
					size={12}
				/>
			</Button>
		{/snippet}

		{#snippet content()}
			<label
				class="border-surface-elevated-border text-fg-tertiary flex shrink-0 items-center gap-2 border-b-[0.5px] px-4"
			>
				<Icon name="search" class="shrink-0" size={13} />
				<TextInput
					bare
					autocomplete="off"
					placeholder="Find models"
					ariaLabel="Find models"
					class="h-9 min-w-0 flex-1 text-[13px]"
					bind:value={query}
					bind:element={filterInput}
					onkeydown={onFilterKeydown}
				/>
			</label>
			<div
				bind:this={list}
				class="min-h-0 overflow-x-hidden overflow-y-auto px-1.5 pt-1.5"
				role="listbox"
				aria-label="Models"
				tabindex="-1"
				onscroll={() => (flyout = null)}
				onfocusin={onListFocus}
			>
				{#if presets.length > 0}
					<div role="group" aria-label="Presets">
						<p class="text-2xs text-fg-tertiary px-2.5 pt-1 pb-0.5 font-medium">Presets</p>
						{#each presets as preset (presetName(preset) + preset.selection.provider)}
							{@const current = sameModelPreset(preset, currentPreset)}
							<div class="group/preset flex items-center">
								<DropdownItem
									role="option"
									aria-selected={current}
									aria-label={presetName(preset)}
									checked={current}
									class="min-w-0 flex-1 gap-2.5"
									data-testid="chat-model-preset"
									onmouseenter={closeFlyout}
									onSelect={() => applyPreset(preset)}
								>
									<ProviderIcon
										providerId={preset.selection.provider}
										class="text-fg-secondary shrink-0"
										size={13}
									/>
									<span class="flex min-w-0 flex-1 items-baseline gap-1.5">
										<span class="truncate leading-5">
											{selectionLabel(groups, preset.selection)}
										</span>
										{#if preset.effort}
											<span class="text-fg-tertiary shrink-0 text-xs">
												{reasoningEffortLabel(preset.effort)}
											</span>
										{/if}
									</span>
									<Icon
										name={current ? 'check' : 'arrow-right'}
										class={['shrink-0', current ? 'text-fg-default' : 'text-fg-tertiary']}
										size={14}
									/>
								</DropdownItem>
								<span
									class="flex w-0 shrink-0 translate-x-3 justify-end overflow-hidden opacity-0 transition-[width,opacity,translate] duration-200 ease-out group-hover/preset:w-8.5 group-hover/preset:translate-x-0 group-hover/preset:opacity-100 group-has-focus-visible/preset:w-8.5 group-has-focus-visible/preset:translate-x-0 group-has-focus-visible/preset:opacity-100 motion-reduce:transition-none"
								>
									<IconButton
										variant="ghost"
										size="auto"
										radius="none"
										class="size-8 rounded-lg"
										ariaLabel={`Remove ${presetName(preset)}`}
										data-testid="chat-model-preset-remove"
										onclick={() => toggleModelPresetCommand(preset)}
									>
										<Icon name="close" size={12} />
									</IconButton>
								</span>
							</div>
						{/each}
					</div>
					<div class="border-surface-elevated-border mx-1 my-1 border-t" role="separator"></div>
				{/if}
				<div role="group" aria-label="Models">
					{#if presets.length > 0}
						<p class="text-2xs text-fg-tertiary px-2.5 pt-1 pb-0.5 font-medium">Models</p>
					{/if}
					{#each rows as row (row.family)}
						{@const runner = rowRunner(row, selection, ready)}
						{@const selected = rowRuns(row, selection)}
						{@const multiple = row.runners.length > 1}
						<DropdownItem
							role="option"
							aria-selected={selected}
							aria-haspopup={multiple ? 'listbox' : undefined}
							aria-expanded={multiple ? flyout?.row.family === row.family : undefined}
							checked={selected}
							class="gap-2.5 py-2"
							data-testid="chat-model-option"
							data-provider={runner.group.id}
							data-model={runner.model.id}
							onmouseenter={(event) => hover(row, event.currentTarget)}
							onkeydown={(event) => onRowKeydown(event, row)}
							onSelect={() => select(runner)}
						>
							<span class="flex min-w-0 flex-1 flex-col">
								<span class="truncate text-[13px] leading-5">{row.label}</span>
								{#if row.description}
									<span class="text-fg-tertiary text-2xs truncate leading-4">
										{row.description}
									</span>
								{/if}
							</span>
							<ProviderIcon
								providerId={runner.group.id}
								ariaLabel={runner.group.name}
								class="text-fg-secondary shrink-0"
								size={13}
							/>
							<span class="flex w-3.5 shrink-0 justify-center">
								{#if selected}
									<Icon name="check" class="text-fg-default" size={14} />
								{:else if multiple}
									<Icon name="chevron-right" class="text-fg-tertiary" size={12} />
								{/if}
							</span>
						</DropdownItem>
					{:else}
						<p class="text-fg-tertiary px-2 py-1.5 text-xs leading-5">No models match</p>
					{/each}
				</div>
			</div>
			<div class="px-1.5 pb-1.5">
				<div class="border-surface-elevated-border mx-1 my-1 border-t" role="separator"></div>
				{#if failedUpdate}
					<DropdownItem
						class="gap-2.5 py-2"
						data-testid="chat-model-claude-update"
						onmouseenter={closeFlyout}
						onSelect={() => void goto(PROVIDER_SETTINGS_HREF)}
					>
						<ProviderIcon
							providerId={CLAUDE_PROVIDER_ID}
							class="text-fg-secondary shrink-0"
							size={13}
						/>
						<span class="flex min-w-0 flex-1 flex-col">
							<span class="truncate text-[13px] leading-5">{failedUpdateLabel(failedUpdate)}</span>
							<span class="text-fg-tertiary text-2xs truncate leading-4">
								Malini could not update it
							</span>
						</span>
						<Icon name="arrow-right" class="text-fg-tertiary shrink-0" size={14} />
					</DropdownItem>
					<div class="border-surface-elevated-border mx-1 my-1 border-t" role="separator"></div>
				{/if}
				<DropdownItem
					closeOnSelect={false}
					class="gap-2.5"
					aria-label={currentSaved
						? `Remove ${presetName(currentPreset)} preset`
						: `Save ${presetName(currentPreset)} as a preset`}
					data-testid="chat-model-preset-toggle"
					onmouseenter={closeFlyout}
					onSelect={() => toggleModelPresetCommand(currentPreset)}
				>
					<Icon name={currentSaved ? 'minus' : 'plus'} class="shrink-0" size={14} />
					<span class="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
						<span>{currentSaved ? 'Remove' : 'Save'}</span>
						<Badge class="min-w-0 gap-1">
							<ProviderIcon providerId={selection.provider} class="shrink-0" size={11} />
							<span class="truncate">{presetName(currentPreset)}</span>
						</Badge>
						<span>{currentSaved ? 'preset' : 'as a preset'}</span>
					</span>
				</DropdownItem>
			</div>
			<Dropdown
				nested
				interactiveTrigger={false}
				open={flyout !== null}
				positionAnchor={flyout?.anchor ?? null}
				side="right"
				align="start"
				sideOffset={12}
				alignOffset={-6}
				keyboardNavigation={false}
				closeOnEscape={false}
				onOpenChange={(next) => {
					if (!next) closeFlyout();
				}}
				panelClass="w-56"
				contentClass=""
				testId="chat-model-runners"
				owner="chat-composer"
				role={null}
			>
				{#snippet trigger()}{/snippet}
				{#snippet content()}
					{#if flyout}
						{@const current = rowRunner(flyout.row, selection, ready)}
						<div
							bind:this={flyoutContent}
							class="p-1.5"
							role="listbox"
							tabindex="-1"
							aria-label={`${flyout.row.label} runs on`}
							onmouseenter={() => clearTimeout(hoverTimer)}
							onkeydown={onFlyoutKeydown}
						>
							<p class="text-2xs text-fg-tertiary px-2.5 pt-1 pb-0.5 font-medium">
								{flyout.row.label} runs on
							</p>
							{#each flyout.row.runners as runner (runner.group.id)}
								{@const chosen = runner === current}
								<DropdownItem
									role="option"
									aria-selected={chosen}
									checked={chosen}
									class="gap-2.5 py-1.5"
									data-testid="chat-model-runner"
									data-provider={runner.group.id}
									onSelect={() => select(runner)}
								>
									<ProviderIcon
										providerId={runner.group.id}
										class={['shrink-0', ready(runner) ? 'text-fg-secondary' : 'text-fg-tertiary']}
										size={14}
									/>
									<span class="flex min-w-0 flex-1 flex-col">
										<span class="truncate text-[13px] leading-5">{runner.group.name}</span>
										<span class="text-fg-tertiary text-2xs truncate leading-4">
											{runnerNote(runner)}
										</span>
									</span>
									{#if chosen}
										<Icon name="check" class="text-fg-default shrink-0" size={14} />
									{/if}
								</DropdownItem>
							{/each}
						</div>
					{/if}
				{/snippet}
			</Dropdown>
		{/snippet}
	</Dropdown>
</div>
