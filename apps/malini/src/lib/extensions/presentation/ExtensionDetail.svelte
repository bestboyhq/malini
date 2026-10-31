<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { PageSection } from '$hyper-ui/components/page-section';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { Well } from '$hyper-ui/components/well';
	import { Icon } from '$hyper-ui/icons';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import { EXTENSIONS_HREF } from '$shared/router/routes-hrefs';
	import { contributionSummary, discoverEntries } from '../domain/extension-entry';
	import { serverHosts } from '../domain/marketplace-manifest';
	import { loadExtensionDetailCommand } from '../application/commands/load-extension-detail.command';
	import { openExternalUrlCommand } from '../application/commands/open-external-url.command';
	import { uninstallExtensionCommand } from '../application/commands/uninstall-extension.command';
	import { extensionActionQuery } from '../application/queries/extension-action.query.svelte';
	import { extensionDetailQuery } from '../application/queries/extension-detail.query.svelte';
	import { extensionEntryQuery } from '../application/queries/extension-entry.query.svelte';
	import ExtensionActionButton from './ExtensionActionButton.svelte';
	import ExtensionFact from './ExtensionFact.svelte';
	import ExtensionReadme from './ExtensionReadme.svelte';

	interface Props {
		publisher: string;
		name: string;
	}

	let { publisher, name }: Props = $props();

	const PUBLISHED_ON = new Intl.DateTimeFormat(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	});

	const listed = $derived(extensionEntryQuery.data(publisher, name));
	const load = $derived(extensionDetailQuery.data(publisher, name));
	const detail = $derived(load?.state === 'ready' ? load.detail : null);
	const entry = $derived(
		listed ?? (detail ? (discoverEntries([detail.listing], [])[0] ?? null) : null),
	);
	const action = $derived(entry ? extensionActionQuery.data(entry.key) : null);
	const hosts = $derived(entry ? serverHosts(entry.mcpServers) : []);
	const repository = $derived(
		entry?.repository?.startsWith('https://') && URL.canParse(entry.repository)
			? entry.repository
			: null,
	);
	const facts = $derived(
		[
			`@${publisher}`,
			entry ? `version ${entry.version}` : null,
			detail ? `published ${PUBLISHED_ON.format(new Date(detail.listing.publishedOn))}` : null,
		].filter((fact): fact is string => fact !== null),
	);

	onMount(() => loadExtensionDetailCommand(publisher, name));
</script>

{#if entry}
	<PageSection title={entry.displayName} description={entry.description} testId="extension-detail">
		{#snippet eyebrow()}
			<Button
				bare
				href={EXTENSIONS_HREF}
				class="text-fg-secondary hover:text-fg-default mb-1.5 inline-flex items-center gap-1 text-xs"
			>
				<Icon name="chevron-left" size={12} />
				Extensions
			</Button>
		{/snippet}
		{#snippet actions()}
			<div class="flex shrink-0 items-center gap-2">
				{#if entry.installed}
					<Button
						variant="secondary"
						size="md"
						radius="full"
						bordered
						loading={action?.status === 'working' && action.work === 'uninstalling'}
						disabled={action?.status === 'working'}
						onclick={() => uninstallExtensionCommand(entry)}
					>
						Uninstall
					</Button>
				{/if}
				<ExtensionActionButton {entry} size="md" />
			</div>
		{/snippet}

		{#if action?.status === 'failed'}
			<p class="text-error-content mx-3 mb-1.5 text-xs" role="alert">{action.error}</p>
		{:else if entry.installed?.withdrawn}
			<p class="text-warning-content mx-3 mb-1.5 text-xs">
				Its publisher withdrew {entry.installed.version}, so Malini turned it off.
			</p>
		{:else if entry.update && entry.update.newHosts.length > 0}
			<p class="text-warning-content mx-3 mb-1.5 text-xs">
				{entry.update.version} also reaches {entry.update.newHosts.join(', ')}. Updating gives it
				that access.
			</p>
		{/if}

		<Well title="Adds to Malini" note={contributionSummary(entry)}>
			<ul class="flex flex-col gap-1.5">
				{#each entry.mcpServers as server (server.name)}
					<li>
						<ExtensionFact
							icon="plug"
							title={server.name}
							note={new URL(server.url).host}
							aside="MCP server in every chat"
						/>
					</li>
				{/each}
				{#each entry.skills as skill (skill)}
					<li>
						<ExtensionFact icon="book" title={skill} aside="Skill, read when a task needs it" />
					</li>
				{/each}
			</ul>
		</Well>

		<Well title="Reaches" note={hosts.length === 0 ? 'nothing' : `${hosts.length}`}>
			<ul class="flex flex-col gap-1.5">
				{#each hosts as host (host)}
					<li><ExtensionFact icon="globe" title={host} aside="Over the network" /></li>
				{/each}
				<li>
					<ExtensionFact
						icon="terminal"
						title="Nothing runs on this Mac"
						aside={hosts.length > 0 ? 'Its servers run remotely' : 'It adds skills only'}
					/>
				</li>
			</ul>
		</Well>

		{#if detail?.readme}
			<Well title="About">
				<div class="bg-surface-100 border-surface-100-border rounded-xl border-[0.5px] px-4 py-3">
					<ExtensionReadme markdown={detail.readme} title={entry.displayName} />
				</div>
			</Well>
		{/if}

		<p class="text-fg-tertiary mx-3 mt-1.5 flex flex-wrap items-center gap-x-2 text-xs">
			{facts.join(' · ')}
			{#if repository}
				<span aria-hidden="true">·</span>
				<Button
					bare
					class="text-fg-secondary hover:text-fg-default text-xs"
					onclick={() => openExternalUrlCommand(repository)}
				>
					{repository.slice('https://'.length)}
				</Button>
			{/if}
		</p>
	</PageSection>
{:else if load?.state === 'failed'}
	<div class="mx-auto mt-10 w-full max-w-[880px] px-1.5">
		<StateBlock
			tone="critical"
			heading={`Malini could not open ${publisher}/${name}`}
			detail={load.error}
			live="alert"
		>
			{#snippet action()}
				<Button variant="secondary" size="sm" href={EXTENSIONS_HREF}>Back to Extensions</Button>
			{/snippet}
		</StateBlock>
	</div>
{:else}
	<div class="mx-auto mt-10 flex w-full max-w-[880px] flex-col gap-1.5 px-4.5">
		<Skeleton height="28px" width="40%" />
		<Skeleton height="16px" width="70%" />
	</div>
{/if}
