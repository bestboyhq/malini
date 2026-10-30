<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import { Button } from '$hyper-ui/components/button';
	import { Checkbox } from '$hyper-ui/components/checkbox';
	import { ComposerShell } from '$hyper-ui/components/composer-shell';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import type { SecretRequest } from '$contract/secrets';
	import { dismissSecretRequestCommand } from '$lib/secrets/application/commands/dismiss-secret-request.command';
	import { saveRequestedSecretsCommand } from '$lib/secrets/application/commands/save-requested-secrets.command';
	import { secretSaveQuery } from '$lib/secrets/application/queries/secret-save.query.svelte';
	import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

	interface Props {
		request: SecretRequest;
	}

	let { request }: Props = $props();

	const VARIABLES = new Intl.ListFormat('en', { type: 'conjunction' });

	let values = $state<Record<string, string>>({});
	let everywhere = $state(false);
	const save = $derived(secretSaveQuery.data(request.id));
	const saving = $derived(save?.status === 'saving');
	const filled = $derived(
		Object.fromEntries(
			request.names.flatMap((name) => {
				const value = values[name]?.trim() ?? '';
				return value.length > 0 ? [[name, value] as const] : [];
			}),
		),
	);
	const scope = $derived(
		request.repository === null || everywhere ? 'every repository' : request.repository,
	);
	const variables = $derived(VARIABLES.format(request.names.map((name) => `$${name}`)));
	const motion = $derived(prefersReducedMotion.current ? 0 : 1);
	const headingId = $props.id();

	function onSubmit(event: SubmitEvent): void {
		event.preventDefault();
		if (saving || Object.keys(filled).length === 0) return;
		saveRequestedSecretsCommand(request, filled, everywhere || request.repository === null);
	}

	function onType(name: string, event: Event): void {
		const input = event.currentTarget;
		if (input instanceof HTMLInputElement) values[name] = input.value;
	}

	function onPaste(name: string, event: ClipboardEvent): void {
		const text = event.clipboardData?.getData('text/plain').trim() ?? '';
		if (!/[\r\n]/u.test(text)) return;
		event.preventDefault();
		values[name] = text;
	}

	function pastedLines(value: string | undefined): number {
		return value?.includes('\n') ? value.split(/\r?\n/u).length : 0;
	}
</script>

<section
	class="chat-column relative z-20 px-4 pb-2"
	aria-labelledby={headingId}
	data-testid="secret-request"
	in:fly={{ y: 10 * motion, duration: 240 * motion, easing: cubicOut }}
>
	<form onsubmit={onSubmit}>
		<ComposerShell testId="secret-request-card" footerTestId="secret-request-footer">
			<header
				class="border-surface-150-border/60 flex h-10 items-center gap-1.5 border-b pr-2 pl-3.5 text-xs"
			>
				<Icon name="key" size={13} class="text-brand-icon shrink-0" />
				<h3 id={headingId} class="text-fg-default min-w-0 flex-1 truncate font-medium">
					{request.names.length === 1
						? 'The agent asks for a secret'
						: `The agent asks for ${request.names.length} secrets`}
				</h3>
				<Tooltip content="Close the card without saving anything" placement="top">
					<Button
						variant="ghost"
						size="xs"
						class="text-fg-secondary shrink-0"
						disabled={saving}
						onclick={() => dismissSecretRequestCommand(request)}
					>
						Dismiss
					</Button>
				</Tooltip>
			</header>
			<div class="flex flex-col gap-3 px-3.5 pt-3 pb-1">
				<p class="text-fg-default text-[15px] leading-6 select-text">{request.why}</p>
				{#each request.names as name (name)}
					{@const lines = pastedLines(values[name])}
					<div class="flex flex-col gap-1.5">
						<p class="flex items-baseline gap-2 text-xs">
							<span class="text-fg-default font-mono">{name}</span>
							{#if request.saved.includes(name)}
								<span class="text-fg-tertiary">Replaces the saved value</span>
							{/if}
						</p>
						{#if lines > 1}
							<div
								class="border-surface-input-border bg-surface-input flex h-9 items-center justify-between gap-2 rounded-md border pr-1.5 pl-3"
							>
								<span class="text-fg-secondary text-sm">{lines} lines pasted</span>
								<Button
									variant="ghost"
									size="xs"
									ariaLabel={`Clear the value for ${name}`}
									disabled={saving}
									onclick={() => (values[name] = '')}
								>
									Clear
								</Button>
							</div>
						{:else}
							<div class="contents" onpastecapture={(event) => onPaste(name, event)}>
								<TextInput
									type="password"
									autocomplete="off"
									ariaLabel={`Value for ${name}`}
									placeholder="Paste the value"
									value={values[name] ?? ''}
									disabled={saving}
									oninput={(event) => onType(name, event)}
								/>
							</div>
						{/if}
					</div>
				{/each}
				{#if save?.status === 'failed'}
					<p class="text-error-content flex items-start gap-1.5 text-xs leading-4" role="alert">
						<Icon name="alert" class="mt-px shrink-0" size={13} />
						<span class="min-w-0">{sanitizeFailureDetail(save.error)}</span>
					</p>
				{/if}
				<p class="text-fg-tertiary text-xs leading-4">
					{request.names.length === 1
						? `Malini seals it in your Mac's keychain. The agent gets ${variables}, never the value.`
						: `Malini seals them in your Mac's keychain. The agent gets ${variables}, never the values.`}
				</p>
			</div>

			{#snippet footer()}
				{#if request.repository !== null}
					<Checkbox label="Every repository" bind:checked={everywhere} disabled={saving} />
				{/if}
				<Button
					type="submit"
					variant="primary"
					size="md"
					class="ml-auto max-w-64 text-xs"
					disabled={Object.keys(filled).length === 0}
					loading={saving}
				>
					<span class="truncate">Save for {scope}</span>
				</Button>
			{/snippet}
		</ComposerShell>
	</form>
</section>
