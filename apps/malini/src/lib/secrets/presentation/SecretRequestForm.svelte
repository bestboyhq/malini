<script lang="ts">
	import { onMount } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import { Button } from '$hyper-ui/components/button';
	import { ComposerShell } from '$hyper-ui/components/composer-shell';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import type { SecretRequest } from '$contract/secrets';
	import { dismissSecretRequestCommand } from '$lib/secrets/application/commands/dismiss-secret-request.command';
	import { saveRequestedSecretsCommand } from '$lib/secrets/application/commands/save-requested-secrets.command';
	import { secretSaveQuery } from '$lib/secrets/application/queries/secret-save.query.svelte';
	import { pastedSecrets } from '$lib/secrets/domain/secret-paste';
	import { sanitizeFailureDetail } from '$shared/errors/failure-copy';
	import { focusIsUnclaimed, overlayIsOpen } from '$shared/shell/unclaimed-focus';

	interface Props {
		request: SecretRequest;
	}

	let { request }: Props = $props();

	const VARIABLES = new Intl.ListFormat('en', { type: 'conjunction' });

	let values = $state<Record<string, string>>({});
	let section = $state<HTMLElement | null>(null);
	let saveButton = $state<HTMLButtonElement | null>(null);
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
	const variables = $derived(VARIABLES.format(request.names.map((name) => `$${name}`)));
	const motion = $derived(prefersReducedMotion.current ? 0 : 1);
	const headingId = $props.id();

	function onSubmit(event: SubmitEvent): void {
		event.preventDefault();
		if (saving || Object.keys(filled).length === 0) return;
		saveRequestedSecretsCommand(request, filled);
	}

	onMount(() => {
		if (mayTakeFocus()) section?.querySelector('input')?.focus({ preventScroll: true });
	});

	function mayTakeFocus(): boolean {
		if (overlayIsOpen()) return false;
		const active = document.activeElement;
		if (focusIsUnclaimed() || !(active instanceof HTMLElement)) return true;
		if (active.closest('[role="dialog"]')) return false;
		const typed =
			active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
				? active.value
				: active.textContent;
		return (typed ?? '').trim().length === 0;
	}

	function onWindowPaste(event: ClipboardEvent): void {
		if (saving || event.defaultPrevented || overlayIsOpen()) return;
		const text = event.clipboardData?.getData('text/plain').trim() ?? '';
		if (text.length === 0) return;
		const target = event.target instanceof Element ? event.target : null;
		const pairs = pastedSecrets(text, request.names);
		if (Object.keys(pairs).length > 0) {
			if (!target?.closest('[role="dialog"]')) fill(event, pairs);
			return;
		}
		const name = fieldOf(target) ?? (focusIsUnclaimed() ? firstEmpty() : undefined);
		if (name !== undefined) fill(event, { [name]: text });
	}

	function fieldOf(target: Element | null): string | undefined {
		if (!target || !section?.contains(target)) return undefined;
		return target.closest('[data-secret-name]')?.getAttribute('data-secret-name') ?? undefined;
	}

	function firstEmpty(): string | undefined {
		return request.names.find((name) => !values[name]?.trim());
	}

	function fill(event: ClipboardEvent, pasted: Readonly<Record<string, string>>): void {
		event.preventDefault();
		event.stopPropagation();
		values = { ...values, ...pasted };
		if (firstEmpty() === undefined) saveButton?.focus();
	}

	function onType(name: string, event: Event): void {
		const input = event.currentTarget;
		if (input instanceof HTMLInputElement) values[name] = input.value;
	}

	function pastedLines(value: string | undefined): number {
		return value?.includes('\n') ? value.split(/\r?\n/u).length : 0;
	}
</script>

<svelte:window onpastecapture={onWindowPaste} />

<section
	bind:this={section}
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
							<TextInput
								type="password"
								autocomplete="off"
								ariaLabel={`Value for ${name}`}
								placeholder="Paste the value"
								value={values[name] ?? ''}
								disabled={saving}
								data-secret-name={name}
								oninput={(event) => onType(name, event)}
							/>
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
				<Button
					bind:element={saveButton}
					type="submit"
					variant="primary"
					size="md"
					class="ml-auto text-xs"
					disabled={Object.keys(filled).length === 0}
					loading={saving}
				>
					Save
				</Button>
			{/snippet}
		</ComposerShell>
	</form>
</section>
