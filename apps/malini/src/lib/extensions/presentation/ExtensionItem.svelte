<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { Switch } from '$hyper-ui/components/switch';
	import { Icon } from '$hyper-ui/icons';
	import type { ExtensionEntry } from '../domain/extension-entry';
	import { serverHosts } from '../domain/marketplace-manifest';
	import { installExtensionCommand } from '../application/commands/install-extension.command';
	import { loadExtensionDetailCommand } from '../application/commands/load-extension-detail.command';
	import { openExternalUrlCommand } from '../application/commands/open-external-url.command';
	import { switchExtensionCommand } from '../application/commands/switch-extension.command';
	import { uninstallExtensionCommand } from '../application/commands/uninstall-extension.command';
	import { extensionActionQuery } from '../application/queries/extension-action.query.svelte';
	import { extensionDetailQuery } from '../application/queries/extension-detail.query.svelte';
	import ExtensionReadme from './ExtensionReadme.svelte';
	import ExtensionTile from './ExtensionTile.svelte';

	interface Props {
		entry: ExtensionEntry;
	}

	let { entry }: Props = $props();

	let open = $state(false);
	const id = $props.id();
	const action = $derived(extensionActionQuery.data(entry.key));
	const working = $derived(action?.status === 'working' ? action.work : null);
	const installed = $derived(entry.installed);
	const withdrawn = $derived(installed?.withdrawn ?? false);
	const off = $derived(installed !== null && !installed.enabled);
	const newHosts = $derived(installed && !withdrawn ? (entry.update?.newHosts ?? []) : []);
	const hosts = $derived(serverHosts(entry.mcpServers));
	const load = $derived(open ? extensionDetailQuery.data(entry.publisher, entry.name) : null);
	const readme = $derived(load?.state === 'ready' ? load.detail.readme : null);
	const repository = $derived(
		entry.repository?.startsWith('https://') && URL.canParse(entry.repository)
			? entry.repository
			: null,
	);

	function toggle(): void {
		open = !open;
		if (open) loadExtensionDetailCommand(entry.publisher, entry.name);
	}
</script>

<li aria-labelledby={`${id}-name`}>
	<div
		class="hover:bg-surface-50-hover relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-2.5 pr-3 pl-3.5"
	>
		<ExtensionTile name={entry.displayName} />
		<div class="min-w-0">
			<h4
				id={`${id}-name`}
				class={['truncate text-sm font-medium', off ? 'text-fg-tertiary' : 'text-fg-default']}
			>
				<Button
					bare
					ariaExpanded={open}
					ariaControls={`${id}-detail`}
					class="focus-visible:after:ring-border-default/50 cursor-pointer text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset"
					onclick={toggle}
				>
					{entry.displayName}
				</Button>
			</h4>
			<p class={['truncate text-xs', off ? 'text-fg-tertiary' : 'text-fg-secondary']}>
				{entry.description}
			</p>
		</div>
		<div class="relative z-10 flex items-center">
			{#if installed}
				<Switch
					checked={installed.enabled}
					disabled={withdrawn || working !== null}
					ariaLabel={entry.displayName}
					onchange={(on) => switchExtensionCommand(entry, on)}
				/>
			{:else}
				<Button
					variant="secondary"
					size="xs"
					loading={working === 'installing'}
					disabled={working !== null}
					ariaLabel={`Install ${entry.displayName}`}
					onclick={() => installExtensionCommand(entry)}
				>
					{working === 'installing' ? 'Installing' : 'Install'}
				</Button>
			{/if}
		</div>
	</div>

	{#if action?.status === 'failed'}
		<p class="text-error-content pr-3 pb-2.5 pl-13.5 text-xs" role="alert">{action.error}</p>
	{:else if withdrawn}
		<p class="text-warning-content pr-3 pb-2.5 pl-13.5 text-xs">
			Its publisher withdrew this version, so Malini turned it off.
		</p>
	{:else if newHosts.length > 0}
		<div
			class="bg-surface-100 text-fg-secondary mr-3 mb-2.5 ml-13.5 flex items-center gap-2 rounded-lg py-1 pr-1 pl-2.5 text-xs"
		>
			<Icon name="globe" size={12} class="text-fg-tertiary shrink-0" />
			<span class="min-w-0 flex-1">
				Its next version also connects to
				<span class="text-fg-default font-medium">{newHosts.join(', ')}</span>
			</span>
			<Button
				variant="secondary"
				size="xs"
				loading={working === 'updating'}
				disabled={working !== null}
				ariaLabel={`Allow ${entry.displayName} to connect to ${newHosts.join(', ')}`}
				onclick={() => installExtensionCommand(entry)}
			>
				Allow
			</Button>
		</div>
	{/if}

	{#if open}
		<div id={`${id}-detail`} class="flex flex-col gap-3 pr-3 pb-3.5 pl-13.5">
			{#if readme}
				<div class="max-w-[560px]">
					<ExtensionReadme markdown={readme} title={entry.displayName} />
				</div>
			{:else if load?.state === 'loading'}
				<div class="flex max-w-[560px] flex-col gap-1.5" aria-label="Loading its README">
					<Skeleton height="12px" width="90%" />
					<Skeleton height="12px" width="60%" />
				</div>
			{/if}
			<ul class="flex flex-wrap gap-1.5" aria-label={`What ${entry.displayName} adds`}>
				{#each entry.mcpServers as server (server.name)}
					<li
						class="bg-surface-100 border-surface-100-border text-fg-secondary flex h-6 items-center gap-1.5 rounded-full border-[0.5px] px-2.5 text-xs"
					>
						<Icon name="plug" size={12} class="text-fg-tertiary" />
						{server.name}
					</li>
				{/each}
				{#each entry.skills as skill (skill)}
					<li
						class="bg-surface-100 border-surface-100-border text-fg-secondary flex h-6 items-center gap-1.5 rounded-full border-[0.5px] px-2.5 text-xs"
					>
						<Icon name="book" size={12} class="text-fg-tertiary" />
						{skill}
					</li>
				{/each}
			</ul>
			<div class="text-fg-tertiary flex min-h-6 flex-wrap items-center gap-x-1.5 text-xs">
				<Icon name={hosts.length > 0 ? 'globe' : 'shield-check'} size={12} />
				<span>
					{hosts.length > 0
						? `Connects to ${hosts.join(', ')}`
						: 'Skills only, it connects nowhere'}
				</span>
				<span aria-hidden="true">·</span>
				<span>by {entry.publisher}</span>
				{#if repository}
					<span aria-hidden="true">·</span>
					<Button
						bare
						class="text-fg-secondary hover:text-fg-default cursor-pointer"
						onclick={() => openExternalUrlCommand(repository)}
					>
						{repository.slice('https://'.length)}
					</Button>
				{/if}
				{#if installed}
					<Button
						variant="ghost"
						size="xs"
						class="ml-auto"
						loading={working === 'uninstalling'}
						disabled={working !== null}
						onclick={() => uninstallExtensionCommand(entry)}
					>
						Uninstall
					</Button>
				{/if}
			</div>
		</div>
	{/if}
</li>
