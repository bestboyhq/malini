<script lang="ts">
	import { onMount } from 'svelte';
	import type { AutomationBuiltin } from '$contract/automations';
	import { Badge } from '$hyper-ui/components/badge';
	import { Button } from '$hyper-ui/components/button';
	import { Switch } from '$hyper-ui/components/switch';
	import { Well } from '$hyper-ui/components/well';
	import { AUTOMATIONS_HREF, BRAIN_HREF, automationHref } from '$shared/router/routes-hrefs';
	import { revealWorkstreamInFinderCommand } from '$shared/repositories/repositories.api';
	import { applyAutomationDefaultsCommand } from '$lib/app/application/commands/apply-automation-defaults.command';
	import { automationDefaultsQuery } from '$lib/app/application/queries/automation-defaults.query.svelte';
	import { scheduleLine } from '$lib/app/domain/automation-defaults';
	import { runModeLabel } from '$lib/automations/automations.api';
	import { loadAutomationsCommand } from '$lib/automations/application/commands/load-automations.command';
	import { watchAutomationsHook } from '$lib/automations/application/hooks/watch-automations.hook';
	import { builtinAutomationDefinitionsQuery } from '$lib/automations/application/queries/builtin-automation-definitions.query.svelte';
	import { loadBrainCommand } from '$lib/brain/application/commands/load-brain.command';
	import { setBrainSyncCommand } from '$lib/brain/application/commands/set-brain-sync.command';
	import { watchBrainHook } from '$lib/brain/application/hooks/watch-brain.hook';
	import { brainQuery } from '$lib/brain/application/queries/brain.query.svelte';
	import SettingsSection from './SettingsSection.svelte';

	const brain = $derived(brainQuery.data);
	const status = $derived(brain.status);
	const defaults = $derived(automationDefaultsQuery.data);
	const on = $derived(defaults.live.brain || brain.settingUp);
	const automations = $derived(
		(['capture-brain', 'write-brain-notes'] satisfies AutomationBuiltin[]).flatMap((builtin) => {
			const definition = builtinAutomationDefinitionsQuery.data.find(
				(candidate) => candidate.builtin === builtin,
			);
			return definition ? [{ builtin, definition }] : [];
		}),
	);
	const ids = $props.id();

	onMount(() => {
		loadBrainCommand();
		loadAutomationsCommand();
		const stopWatchingAutomations = watchAutomationsHook();
		const stopWatchingBrain = watchBrainHook();
		return () => {
			stopWatchingAutomations();
			stopWatchingBrain();
		};
	});

	function detail(builtin: AutomationBuiltin, when: string | undefined): [string, string, string] {
		if (builtin === 'capture-brain') {
			return [
				'When a chat is archived, and daily for organization chats. Writes',
				'log/',
				'and never rewrites it.',
			];
		}
		return [
			`${scheduleLine(when) ?? 'When you run it'}. Reads the log, rewrites`,
			'notes/',
			'and sees only the brain.',
		];
	}

	function turn(brainOn: boolean): void {
		applyAutomationDefaultsCommand({ ...defaults.live, brain: brainOn });
	}
</script>

<SettingsSection title="Brain" description="Notes on what your chats taught you.">
	{#snippet actions()}
		{#if status?.set}
			<Button variant="secondary" size="md" radius="full" bordered href={BRAIN_HREF}>
				Open the brain
			</Button>
		{/if}
	{/snippet}

	{#if status?.problem}
		<div
			class="border-surface-50-border bg-surface-50 flex items-center gap-3 rounded-xl border-[0.5px] px-4 py-3"
			role="alert"
		>
			<p class="text-error-content min-w-0 flex-1 text-xs">{status.problem}</p>
			<Button
				variant="secondary"
				size="sm"
				loading={brain.syncing}
				onclick={() => setBrainSyncCommand(true)}
			>
				Retry
			</Button>
		</div>
	{/if}

	<Well title="Brain" headed={false}>
		<div
			class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]"
		>
			<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3">
				<div class="min-w-0">
					<h3 id="{ids}-brain" class="text-fg-default text-sm font-medium">Second brain</h3>
					<p class="text-fg-tertiary text-xs">
						A private repository Malini writes and you read. Obsidian opens it as a vault.
					</p>
				</div>
				<Switch
					checked={on}
					disabled={!defaults.ready || brain.settingUp}
					labelledBy="{ids}-brain"
					onchange={turn}
				/>
			</div>
			{#if status?.set}
				<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3">
					<div class="min-w-0">
						<h3 id="{ids}-sync" class="text-fg-default text-sm font-medium">Sync with GitHub</h3>
						<p class="text-fg-tertiary text-xs">
							{#if status.repository}
								Pushes to main in {status.repository}, no pull request. Off keeps it on this Mac.
							{:else}
								This brain lives on this Mac only.
							{/if}
						</p>
					</div>
					<Switch
						checked={status.sync}
						disabled={status.repository === null || brain.syncing}
						labelledBy="{ids}-sync"
						onchange={setBrainSyncCommand}
					/>
				</div>
				<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3">
					<div class="min-w-0">
						<h3 class="text-fg-default text-sm font-medium">Location</h3>
						{#if status.location}
							<p class="text-fg-tertiary text-2xs font-mono wrap-anywhere">{status.location}</p>
						{/if}
					</div>
					<Button
						variant="secondary"
						size="sm"
						disabled={status.workstreamId === null}
						onclick={() => {
							if (status.workstreamId) revealWorkstreamInFinderCommand(status.workstreamId);
						}}
					>
						Reveal in Finder
					</Button>
				</div>
			{/if}
		</div>
	</Well>

	{#if status?.set}
		<Well title="Its automations">
			<div
				class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]"
			>
				{#each automations as { builtin, definition } (definition.id)}
					{@const [before, folder, after] = detail(builtin, definition.trigger?.when)}
					<div class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-4 py-3">
						<div class="min-w-0">
							<h3 class="text-fg-default text-sm font-medium">{definition.name}</h3>
							<p class="text-fg-tertiary text-xs">
								{before}
								<code class="font-mono">{folder}</code>
								{after}
							</p>
						</div>
						<Badge>{runModeLabel(definition.trigger?.mode ?? 'off')}</Badge>
						<Button
							variant="ghost"
							size="sm"
							href={automationHref(definition.id)}
							ariaLabel={`Edit ${definition.name}`}
						>
							Edit
						</Button>
					</div>
				{/each}
			</div>
			<p class="text-fg-tertiary px-3 pt-1 pb-1.5 text-xs">
				Rewrite their instructions to change what the brain pays attention to.
				<a class="text-fg-secondary underline underline-offset-3" href={AUTOMATIONS_HREF}>
					Edit in Automations
				</a>
			</p>
		</Well>

		<Well title="What leaves this Mac">
			<p class="text-fg-secondary px-3 pb-1.5 text-xs">
				{#if status.sync && status.repository}
					Your private repository on GitHub gets the log and the notes. Malini sends no chat
					anywhere else.
				{:else}
					Nothing. The brain stays on this Mac.
				{/if}
			</p>
		</Well>
	{/if}
</SettingsSection>
