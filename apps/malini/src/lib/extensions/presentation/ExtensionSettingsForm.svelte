<script lang="ts">
	import type {
		ExtensionManifest,
		ExtensionSettingManifest,
		ExtensionSettingValue,
	} from '@malini/extension-api';
	import { Switch } from '$hyper-ui/components/switch';
	import { Select } from '$hyper-ui/components/select';
	import { TextInput } from '$hyper-ui/components/text-input';
	import {
		resolveDirectorySettingScope,
		type ExtensionSettingsAccessPort,
	} from '$shared/extensions/settings-access';

	interface Props {
		manifest: ExtensionManifest;
		access: ExtensionSettingsAccessPort;
		workstreamId?: string | undefined;
		repositoryPath?: string | undefined;
		repositoryFullName?: string | undefined;
	}

	let { manifest, access, workstreamId, repositoryPath, repositoryFullName }: Props = $props();
	let revision = $state(0);
	let error = $state<string | null>(null);
	const definitions = $derived(access.definitions(manifest));

	function current(definition: ExtensionSettingManifest): ExtensionSettingValue {
		revision;
		const scope = resolveDirectorySettingScope(definition, {
			workstreamId,
			repositoryPath,
			repositoryFullName,
		});
		return scope ? access.get(manifest.id, definition, scope) : definition.default;
	}

	async function update(definition: ExtensionSettingManifest, value: ExtensionSettingValue) {
		const scope = resolveDirectorySettingScope(definition, {
			workstreamId,
			repositoryPath,
			repositoryFullName,
		});
		if (!scope) return;
		try {
			await access.set(manifest.id, definition, value, scope);
			revision += 1;
			error = null;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}
</script>

<section class="grid gap-3" aria-labelledby="extension-settings-heading">
	<div>
		<h2 id="extension-settings-heading" class="text-fg-default text-base font-medium">Settings</h2>
		<p class="text-fg-tertiary mt-1 text-sm leading-5">
			Fine-tune how this extension behaves in the active repository.
		</p>
	</div>

	{#if error}
		<p class="bg-error/10 text-error-content rounded-lg px-3 py-2 text-sm" role="alert">{error}</p>
	{/if}

	{#if definitions.length === 0}
		<p
			class="border-surface-150-border bg-surface-150 text-fg-secondary rounded-xl border px-4 py-3 text-sm"
		>
			This extension has no configurable settings.
		</p>
	{:else}
		<div
			class="divide-border-subtle border-surface-150-border bg-surface-150 divide-y overflow-hidden rounded-xl border"
		>
			{#each definitions as definition (definition.id)}
				{@const scope = resolveDirectorySettingScope(definition, {
					workstreamId,
					repositoryPath,
					repositoryFullName,
				})}
				<div
					class="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)] sm:items-center"
				>
					<div class="min-w-0">
						<div class="text-fg-default text-sm font-medium">{definition.label}</div>
						{#if definition.description}
							<p class="text-fg-tertiary mt-1 text-xs leading-5">{definition.description}</p>
						{/if}
						{#if !scope}
							<p class="text-warning-content mt-1 text-xs leading-5">
								Open a repository before changing this preference.
							</p>
						{/if}
					</div>

					{#if definition.type === 'boolean'}
						<div class="flex justify-end">
							<Switch
								checked={Boolean(current(definition))}
								disabled={!scope}
								ariaLabel={definition.label}
								onchange={(checked) => void update(definition, checked)}
							/>
						</div>
					{:else if definition.type === 'select'}
						<Select
							value={String(current(definition))}
							options={[...(definition.options ?? [])]}
							ariaLabel={definition.label}
							disabled={!scope}
							onchange={(value) => void update(definition, value)}
						/>
					{:else}
						<TextInput
							value={definition.type === 'number'
								? Number(current(definition))
								: String(current(definition))}
							type={definition.type === 'number' ? 'number' : 'text'}
							disabled={!scope}
							onchange={(event) => {
								const input = event.currentTarget;
								if (!(input instanceof HTMLInputElement)) return;
								void update(
									definition,
									definition.type === 'number' ? Number(input.value) : input.value,
								);
							}}
						/>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</section>
