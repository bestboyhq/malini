<script lang="ts">
	import type { ModelSelection } from '$shared/providers/domain/model-preferences';
	import {
		allProviderModels,
		catalogModelLabel,
		effortsForModel,
		normalizeReasoningEffort,
	} from '$shared/providers/domain/model-catalog';
	import { providerGroupsQuery } from '$shared/providers/application/queries/provider-groups.query.svelte';
	import { agentAccessDefaultQuery } from '$shared/providers/application/queries/agent-access-default.query.svelte';
	import {
		AGENT_ACCESS_DETAILS,
		AGENT_ACCESS_LEVELS,
		AGENT_REPORT_DETAILS,
		AGENT_REPORTS,
		DEFAULT_AGENT_REPORT,
		type AgentAccess,
		type AgentReasoningEffort,
		type AgentReport,
		type AgentRunProfile,
	} from '$shared/providers/domain/run-profile';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import { Button } from '$hyper-ui/components/button';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { getOverlayFocusReturn } from '$hyper-ui/overlay';
	import { goto } from '$shared/router/navigation';
	import { MODEL_SETTINGS_HREF } from '$shared/router/routes-hrefs';

	interface Props {
		selection: ModelSelection;
		profile: AgentRunProfile;
		disabled?: boolean;
		onchange: (profile: AgentRunProfile) => void;
	}

	let { selection, profile, disabled = false, onchange }: Props = $props();
	let effortTrigger: HTMLAnchorElement | HTMLButtonElement | null = $state(null);
	let effortOpen = $state(false);
	let optionsTrigger: HTMLAnchorElement | HTMLButtonElement | null = $state(null);
	let accessChip: HTMLAnchorElement | HTMLButtonElement | null = $state(null);
	let reportChip: HTMLAnchorElement | HTMLButtonElement | null = $state(null);
	let optionsAnchor: HTMLElement | null = $state(null);
	let optionsOpen = $state(false);
	const focusReturn = getOverlayFocusReturn();
	const defaultAccess = $derived(agentAccessDefaultQuery.data);
	const accessIcons: Record<AgentRunProfile['access'], IconName> = {
		sandboxed: 'lock',
		auto: 'unlock',
		full: 'shield-alert',
	};
	const reportIcons: Record<AgentReport, IconName> = {
		low: 'preview',
		medium: 'checklist',
		high: 'note',
	};
	const catalog = $derived(allProviderModels(providerGroupsQuery.data));
	const efforts = $derived(effortsForModel(catalog, selection.model));
	const effortSupported = $derived(efforts.length > 0);
	const effortHelp = $derived(
		effortSupported
			? 'Adjust reasoning effort'
			: `${catalogModelLabel(catalog, selection.model)} does not take a reasoning effort`,
	);

	function effortLabel(value: AgentReasoningEffort): string {
		if (value === 'xhigh') return 'Extra high';
		return value[0]?.toUpperCase() + value.slice(1);
	}

	$effect(() => {
		const normalized = normalizeReasoningEffort(efforts, profile.effort);
		if (effortSupported && normalized !== profile.effort) {
			onchange({ ...profile, effort: normalized });
		}
	});

	function selectEffort(effort: AgentReasoningEffort): void {
		if (disabled || !effortSupported) return;
		onchange({ ...profile, effort });
		closeEffort();
	}

	function closeEffort(): void {
		effortOpen = false;
	}

	function toggleEffort(): void {
		if (disabled || !effortSupported) return;
		effortOpen = !effortOpen;
	}

	function selectAccess(access: AgentAccess): void {
		if (disabled) return;
		onchange({ ...profile, access });
		closeOptions();
	}

	function selectReport(report: AgentReport): void {
		if (disabled) return;
		onchange({ ...profile, report });
		closeOptions();
	}

	function toggleOptions(anchor: HTMLElement | null): void {
		if (disabled) return;
		if (optionsOpen && optionsAnchor === anchor) {
			closeOptions();
			return;
		}
		optionsAnchor = anchor;
		optionsOpen = true;
	}

	function closeOptions(): void {
		optionsOpen = false;
	}

	function optionsOpenFrom(trigger: HTMLElement | null): boolean {
		return optionsOpen && optionsAnchor === trigger;
	}

	function exitPlanMode(): void {
		togglePlan();
		focusReturn?.();
	}

	function togglePlan(): void {
		if (disabled) return;
		onchange({ ...profile, mode: profile.mode === 'plan' ? 'agent' : 'plan' });
		closeOptions();
	}

	function openModelSettings(): void {
		closeOptions();
		void goto(MODEL_SETTINGS_HREF);
	}
</script>

<div class="flex shrink-0 items-center gap-0.5" data-testid="chat-profile-controls">
	<div>
		<Tooltip content={effortHelp} placement="top" suppressed={effortOpen}>
			<Button
				bind:element={effortTrigger}
				variant="ghost"
				size="auto"
				active={effortOpen}
				class="text-fg-tertiary hover:bg-surface-50 h-7 gap-1.5 rounded-md px-2 text-xs font-normal"
				disabled={disabled || !effortSupported}
				ariaLabel="Reasoning effort"
				ariaHasPopup="listbox"
				ariaExpanded={effortOpen}
				data-testid="chat-reasoning-effort"
				data-effort-supported={effortSupported ? 'true' : 'false'}
				onclick={toggleEffort}
			>
				<Icon name="signal" size={15} />
				<span class="@max-md/composer:hidden">
					{effortSupported ? effortLabel(profile.effort) : 'None'}
				</span>
			</Button>
		</Tooltip>

		<DropdownLayer
			open={effortOpen}
			anchor={effortTrigger}
			onclose={closeEffort}
			side="top"
			align="start"
			panelClass="w-40 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1.5"
			testId="chat-reasoning-menu"
			owner="chat-composer"
		>
			<div role="listbox" aria-label="Reasoning effort levels">
				{#each efforts as effort (effort)}
					<DropdownItem
						checked={profile.effort === effort}
						focusOnHover={false}
						class="justify-between"
						role="option"
						aria-selected={profile.effort === effort}
						onclick={() => selectEffort(effort)}
					>
						<span>{effortLabel(effort)}</span>
						{#if profile.effort === effort}
							<Icon name="check" size={14} />
						{/if}
					</DropdownItem>
				{/each}
			</div>
		</DropdownLayer>
	</div>

	{#if profile.mode === 'plan'}
		<Tooltip content="Exit plan mode" placement="top">
			<Button
				variant="primary-soft"
				size="auto"
				class="h-7 gap-1.5 rounded-md px-2 text-xs font-normal"
				{disabled}
				ariaLabel="Plan mode"
				ariaPressed={true}
				data-testid="chat-plan-mode"
				onclick={exitPlanMode}
			>
				<Icon name="route" class="shrink-0" size={16} />
				<span class="@max-3xl/composer:hidden">Plan</span>
			</Button>
		</Tooltip>
	{/if}
	{#if profile.access !== defaultAccess}
		<Tooltip
			content={AGENT_ACCESS_DETAILS[profile.access].description}
			placement="top"
			suppressed={optionsOpen}
		>
			<Button
				bind:element={accessChip}
				variant="ghost"
				size="auto"
				active={optionsOpenFrom(accessChip)}
				class={[
					'hover:bg-surface-50 h-7 gap-1.5 rounded-md px-2 text-xs font-normal',
					profile.access === 'full' ? 'text-warning-content' : 'text-fg-tertiary',
				]}
				{disabled}
				ariaLabel={`Agent access: ${AGENT_ACCESS_DETAILS[profile.access].label}`}
				ariaHasPopup="menu"
				ariaExpanded={optionsOpenFrom(accessChip)}
				data-testid="chat-agent-access"
				onclick={() => toggleOptions(accessChip)}
			>
				<Icon name={accessIcons[profile.access]} size={15} />
				<span class="@max-3xl/composer:hidden">{AGENT_ACCESS_DETAILS[profile.access].label}</span>
			</Button>
		</Tooltip>
	{/if}
	{#if profile.report !== DEFAULT_AGENT_REPORT}
		<Tooltip
			content={AGENT_REPORT_DETAILS[profile.report].description}
			placement="top"
			suppressed={optionsOpen}
		>
			<Button
				bind:element={reportChip}
				variant="ghost"
				size="auto"
				active={optionsOpenFrom(reportChip)}
				class="text-fg-tertiary hover:bg-surface-50 h-7 gap-1.5 rounded-md px-2 text-xs font-normal"
				{disabled}
				ariaLabel={`Report: ${AGENT_REPORT_DETAILS[profile.report].label}`}
				ariaHasPopup="menu"
				ariaExpanded={optionsOpenFrom(reportChip)}
				data-testid="chat-report"
				onclick={() => toggleOptions(reportChip)}
			>
				<Icon name={reportIcons[profile.report]} size={15} />
				<span class="@max-3xl/composer:hidden">
					{AGENT_REPORT_DETAILS[profile.report].label} report
				</span>
			</Button>
		</Tooltip>
	{/if}
	<Tooltip
		content="Plan mode, agent access, report, and models"
		placement="top"
		suppressed={optionsOpen}
	>
		<IconButton
			bind:element={optionsTrigger}
			variant="ghost"
			size="md"
			ariaLabel="Run options"
			ariaHasPopup="menu"
			ariaExpanded={optionsOpenFrom(optionsTrigger)}
			active={optionsOpenFrom(optionsTrigger)}
			class="text-fg-tertiary hover:bg-surface-50 rounded-lg"
			data-testid="chat-run-options"
			{disabled}
			onclick={() => toggleOptions(optionsTrigger)}
		>
			<Icon name="settings" size={15} />
		</IconButton>
	</Tooltip>

	<DropdownLayer
		role={null}
		open={optionsOpen}
		anchor={optionsAnchor}
		onclose={closeOptions}
		side="top"
		align="start"
		panelClass="w-80 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1.5"
		testId="chat-run-options-menu"
		owner="chat-composer"
	>
		<div role="menu" aria-label="Run options" class="space-y-0.5">
			<DropdownItem
				role="menuitemcheckbox"
				aria-checked={profile.mode === 'plan'}
				checked={profile.mode === 'plan'}
				focusOnHover={false}
				class="items-start gap-2.5 py-2"
				onclick={togglePlan}
			>
				<Icon name="route" size={15} class="mt-0.5 shrink-0" />
				<span class="flex min-w-0 flex-1 flex-col gap-0.5">
					<span>Plan mode</span>
					<span class="text-fg-tertiary text-xs whitespace-normal">
						Plan the change first, then start the implementation from the plan.
					</span>
				</span>
				{#if profile.mode === 'plan'}
					<Icon name="check" size={14} class="mt-0.5 shrink-0" />
				{/if}
			</DropdownItem>

			<div class="border-surface-elevated-border mx-1 my-1 border-t" role="separator"></div>
			<div role="group" aria-labelledby="chat-agent-access-heading">
				<p
					id="chat-agent-access-heading"
					class="text-2xs text-fg-tertiary px-2.5 pt-1 pb-0.5 font-medium"
				>
					Agent access
				</p>
				{#each AGENT_ACCESS_LEVELS as access (access)}
					<DropdownItem
						role="menuitemradio"
						aria-checked={profile.access === access}
						checked={profile.access === access}
						focusOnHover={false}
						class="items-start gap-2.5 py-2"
						onclick={() => selectAccess(access)}
					>
						<Icon name={accessIcons[access]} size={15} class="mt-0.5 shrink-0" />
						<span class="flex min-w-0 flex-1 flex-col gap-0.5">
							<span>{AGENT_ACCESS_DETAILS[access].label}</span>
							<span class="text-fg-tertiary text-xs whitespace-normal">
								{AGENT_ACCESS_DETAILS[access].description}
							</span>
						</span>
						{#if profile.access === access}
							<Icon name="check" size={14} class="mt-0.5 shrink-0" />
						{/if}
					</DropdownItem>
				{/each}
			</div>

			<div class="border-surface-elevated-border mx-1 my-1 border-t" role="separator"></div>
			<div role="group" aria-labelledby="chat-report-heading">
				<p
					id="chat-report-heading"
					class="text-2xs text-fg-tertiary px-2.5 pt-1 pb-0.5 font-medium"
				>
					Report
				</p>
				{#each AGENT_REPORTS as report (report)}
					<DropdownItem
						role="menuitemradio"
						aria-checked={profile.report === report}
						checked={profile.report === report}
						focusOnHover={false}
						class="items-start gap-2.5 py-2"
						onclick={() => selectReport(report)}
					>
						<Icon name={reportIcons[report]} size={15} class="mt-0.5 shrink-0" />
						<span class="flex min-w-0 flex-1 flex-col gap-0.5">
							<span>{AGENT_REPORT_DETAILS[report].label}</span>
							<span class="text-fg-tertiary text-xs whitespace-normal">
								{AGENT_REPORT_DETAILS[report].description}
							</span>
						</span>
						{#if profile.report === report}
							<Icon name="check" size={14} class="mt-0.5 shrink-0" />
						{/if}
					</DropdownItem>
				{/each}
			</div>

			<div class="border-surface-elevated-border mx-1 my-1 border-t" role="separator"></div>
			<DropdownItem
				role="menuitem"
				focusOnHover={false}
				class="gap-2.5"
				onclick={openModelSettings}
			>
				<Icon name="settings" size={15} class="shrink-0" />
				Model settings…
			</DropdownItem>
		</div>
	</DropdownLayer>
</div>
