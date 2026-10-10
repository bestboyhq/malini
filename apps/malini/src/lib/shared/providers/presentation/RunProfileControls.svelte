<script lang="ts">
	import type { AgentModel } from '$shared/providers/domain/model-id';
	import {
		catalogModelLabel,
		effortsForModel,
		normalizeReasoningEffort,
	} from '$shared/providers/domain/model-catalog';
	import { modelCatalogQuery } from '$shared/providers/application/queries/model-catalog.query.svelte';
	import {
		AGENT_ACCESS_DETAILS,
		AGENT_ACCESS_LEVELS,
		type AgentAccess,
		type AgentReasoningEffort,
		type AgentRunProfile,
	} from '$shared/providers/domain/run-profile';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import { Button } from '$hyper-ui/components/button';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { Tooltip } from '$hyper-ui/components/tooltip';

	interface Props {
		model: AgentModel;
		profile: AgentRunProfile;
		disabled?: boolean;
		onchange: (profile: AgentRunProfile) => void;
	}

	let { model, profile, disabled = false, onchange }: Props = $props();
	let effortTrigger: HTMLAnchorElement | HTMLButtonElement | null = $state(null);
	let effortOpen = $state(false);
	let accessTrigger: HTMLAnchorElement | HTMLButtonElement | null = $state(null);
	let accessOpen = $state(false);
	const accessIcons: Record<AgentRunProfile['access'], IconName> = {
		sandboxed: 'lock',
		auto: 'unlock',
		full: 'shield-alert',
	};
	const catalog = $derived(modelCatalogQuery.data);
	const efforts = $derived(effortsForModel(catalog, model));
	const effortSupported = $derived(efforts.length > 0);
	const effortHelp = $derived(
		effortSupported
			? 'Adjust reasoning effort'
			: `${catalogModelLabel(catalog, model)} does not take a reasoning effort`,
	);
	const planHelp = $derived(profile.mode === 'plan' ? 'Exit plan mode' : 'Enter plan mode');

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
		closeAccess();
	}

	function closeAccess(): void {
		accessOpen = false;
	}

	function togglePlan(): void {
		if (disabled) return;
		onchange({ ...profile, mode: profile.mode === 'plan' ? 'agent' : 'plan' });
	}
</script>

<div class="flex shrink-0 items-center gap-0.5" data-testid="chat-profile-controls">
	<div>
		<Tooltip content={effortHelp} placement="top" suppressed={effortOpen}>
			<Button
				bind:element={effortTrigger}
				variant="ghost"
				size="md"
				active={effortOpen}
				class="text-fg-tertiary hover:bg-surface-50 gap-1.5 rounded-md text-xs font-normal"
				disabled={disabled || !effortSupported}
				ariaLabel="Reasoning effort"
				ariaHasPopup="listbox"
				ariaExpanded={effortOpen}
				data-testid="chat-reasoning-effort"
				data-effort-supported={effortSupported ? 'true' : 'false'}
				onclick={toggleEffort}
			>
				<Icon name="signal" size={15} />
				<span>{effortSupported ? effortLabel(profile.effort) : 'Default'}</span>
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
				{#each efforts as effort}
					<DropdownItem
						selected={profile.effort === effort}
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

	<Tooltip content={planHelp} placement="top">
		<Button
			variant={profile.mode === 'plan' ? 'primary-soft' : 'ghost'}
			size="md"
			class={[
				'gap-1.5 rounded-md text-xs font-normal',
				profile.mode === 'plan' ? '' : 'text-fg-tertiary hover:bg-surface-50',
			]}
			{disabled}
			ariaLabel="Plan mode"
			ariaPressed={profile.mode === 'plan'}
			data-testid="chat-plan-mode"
			onclick={togglePlan}
		>
			<Icon name="route" class="shrink-0" size={16} />
			<span class="@max-2xl/composer:hidden">Plan</span>
		</Button>
	</Tooltip>
	<div>
		<Tooltip
			content={AGENT_ACCESS_DETAILS[profile.access].description}
			placement="top"
			suppressed={accessOpen}
		>
			<Button
				bind:element={accessTrigger}
				variant="ghost"
				size="md"
				active={accessOpen}
				class="text-fg-tertiary hover:bg-surface-50 gap-1.5 rounded-md text-xs font-normal"
				{disabled}
				ariaLabel="Agent access"
				ariaHasPopup="listbox"
				ariaExpanded={accessOpen}
				data-testid="chat-agent-access"
				onclick={() => (accessOpen = !accessOpen)}
			>
				<Icon name={accessIcons[profile.access]} size={15} />
				<span class="@max-2xl/composer:hidden">{AGENT_ACCESS_DETAILS[profile.access].label}</span>
			</Button>
		</Tooltip>

		<DropdownLayer
			open={accessOpen}
			anchor={accessTrigger}
			onclose={closeAccess}
			side="top"
			align="start"
			panelClass="w-72 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1.5"
			testId="chat-agent-access-menu"
			owner="chat-composer"
		>
			<div role="listbox" aria-label="Agent access levels">
				{#each AGENT_ACCESS_LEVELS as access}
					<DropdownItem
						selected={profile.access === access}
						focusOnHover={false}
						class="items-start justify-between gap-3 py-2"
						role="option"
						aria-selected={profile.access === access}
						onclick={() => selectAccess(access)}
					>
						<span class="flex min-w-0 flex-col gap-0.5">
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
		</DropdownLayer>
	</div>
</div>
