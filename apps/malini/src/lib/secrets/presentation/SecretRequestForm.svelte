<script lang="ts">
	import { onMount } from 'svelte';
	import { backOut, cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly, scale } from 'svelte/transition';
	import { Button } from '$hyper-ui/components/button';
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

	let values = $state<Record<string, string>>({});
	let focused = $state<string | null>(null);
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
	const firstEmpty = $derived(request.names.find((name) => !Object.hasOwn(filled, name)));
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
		const name = fieldOf(target) ?? (focusIsUnclaimed() ? firstEmpty : undefined);
		if (name !== undefined) fill(event, { [name]: text });
	}

	function fieldOf(target: Element | null): string | undefined {
		if (!target || !section?.contains(target)) return undefined;
		return target.closest('[data-secret-name]')?.getAttribute('data-secret-name') ?? undefined;
	}

	function fill(event: ClipboardEvent, pasted: Readonly<Record<string, string>>): void {
		event.preventDefault();
		event.stopPropagation();
		values = { ...values, ...pasted };
		if (firstEmpty === undefined) saveButton?.focus();
	}

	function onType(name: string, event: Event): void {
		const input = event.currentTarget;
		if (input instanceof HTMLInputElement) values[name] = input.value;
	}

	function placeholder(name: string): string {
		if (request.saved.includes(name)) return 'Saved, paste to replace';
		return focused === name || (focused === null && name === firstEmpty) ? 'Paste the value' : '';
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
	<form
		class="border-surface-elevated-border bg-surface-elevated overflow-hidden rounded-xl border-[0.5px]"
		data-testid="secret-request-card"
		onsubmit={onSubmit}
	>
		<header
			class="border-surface-elevated-border flex min-h-10 items-center gap-1.5 border-b-[0.5px] py-2 pr-2 pl-3.5 text-xs"
		>
			<Icon name="key" size={13} class="text-brand-icon shrink-0" />
			<h3 id={headingId} class="text-fg-default line-clamp-2 min-w-0 flex-1 font-medium">
				{request.why}
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
		<div class="flex flex-col gap-2 px-3.5 pt-3 pb-1">
			<div
				role="group"
				aria-labelledby={headingId}
				class="border-surface-input-border bg-surface-input divide-surface-input-border grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] divide-y overflow-hidden rounded-lg border"
			>
				{#each request.names as name (name)}
					{@const lines = pastedLines(values[name])}
					{@const inputId = `${headingId}-${name}`}
					<div class="col-span-full grid h-9 grid-cols-subgrid">
						<label
							for={inputId}
							class={[
								'text-2xs cursor-text self-center truncate px-3 font-mono',
								Object.hasOwn(filled, name) || focused === name
									? 'text-fg-default'
									: 'text-fg-secondary',
							]}
						>
							{name}
						</label>
						<div
							class="border-surface-input-border flex min-w-0 items-center gap-2 border-l pr-3 pl-3"
						>
							{#if lines > 1}
								<span class="text-fg-secondary min-w-0 flex-1 truncate text-sm">
									{lines} lines pasted
								</span>
								<Button
									variant="ghost"
									size="xs"
									ariaLabel={`Clear the value for ${name}`}
									disabled={saving}
									onclick={() => (values[name] = '')}
								>
									Clear
								</Button>
							{:else}
								<TextInput
									bare
									id={inputId}
									type="password"
									autocomplete="off"
									ariaLabel={`Value for ${name}`}
									placeholder={placeholder(name)}
									value={values[name] ?? ''}
									disabled={saving}
									class="min-w-0 flex-1"
									inputClass="h-9 text-sm"
									data-secret-name={name}
									oninput={(event) => onType(name, event)}
									onfocus={() => (focused = name)}
									onblur={() => (focused = null)}
								/>
							{/if}
							{#if Object.hasOwn(filled, name)}
								<span
									class="text-success-content grid shrink-0"
									in:scale={{ start: 0.6, duration: 220 * motion, easing: backOut }}
								>
									<Icon name="check" size={14} />
								</span>
							{/if}
						</div>
					</div>
				{/each}
			</div>
			{#if save?.status === 'failed'}
				<p class="text-error-content flex items-start gap-1.5 text-xs leading-4" role="alert">
					<Icon name="alert" class="mt-px shrink-0" size={13} />
					<span class="min-w-0">{sanitizeFailureDetail(save.error)}</span>
				</p>
			{/if}
		</div>
		<div class="flex h-11 items-center justify-between gap-3 px-3 pb-2">
			<span class="text-fg-tertiary text-3xs inline-flex items-center gap-1.5 pl-0.5">
				<Icon name="lock" size={12} />
				Sealed in your keychain
			</span>
			<Button
				bind:element={saveButton}
				type="submit"
				variant="primary"
				size="md"
				class="text-xs"
				disabled={Object.keys(filled).length === 0}
				loading={saving}
			>
				Save
			</Button>
		</div>
	</form>
</section>
