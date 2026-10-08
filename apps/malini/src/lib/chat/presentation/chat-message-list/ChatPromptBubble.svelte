<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { ComposerShell } from '$hyper-ui/components/composer-shell';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Textarea } from '$hyper-ui/components/textarea';
	import { Icon } from '$hyper-ui/icons';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { isWithinOverlaySurface } from '$hyper-ui/overlay';
	import type { RenderItem, RunGroup } from '../render-state';
	import {
		ModelDefaultsSettings,
		ModelProfilePicker,
		RunProfileControls,
	} from '$shared/providers/providers.api';
	import InlinePromptContent from '../InlinePromptContent.svelte';
	import SessionRuntimeControls from '../SessionRuntimeControls.svelte';
	import { checkpointRestoreWarning } from './checkpoint-edit.svelte';
	import { OPEN_RUN_BLOCKS_RESTORE } from './destructive-confirm.svelte';
	import { clampPrompt } from './clamp-prompt';
	import ChatPromptChips from './ChatPromptChips.svelte';
	import { transcriptContext } from './transcript-context';

	interface Props {
		item: Extract<RenderItem, { kind: 'user' }>;
		run: RunGroup;
		isLastRun: boolean;
	}

	let { item, run, isLastRun }: Props = $props();

	const transcript = transcriptContext();
	const { promptArrival, checkpointEdit } = transcript;
	const editable = $derived(Boolean(item.checkpointId && !run.superseded && !run.obsoleted));

	const blocked = $derived(transcript.workstreamRunInFlight);
	const editing = $derived(checkpointEdit.isEditing(item));
	const submitting = $derived(checkpointEdit.checkpointEditState === 'submitting');
	const canSend = $derived(
		!blocked && !submitting && checkpointEdit.editingPrompt.trim().length > 0,
	);

	let editorEl: HTMLFormElement | null = $state(null);

	$effect(() => {
		const form = editorEl;
		if (!editing || !form) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node) || form.contains(target)) return;
			if (isWithinOverlaySurface(target)) return;
			checkpointEdit.cancelCheckpointEdit();
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		return () => document.removeEventListener('pointerdown', onPointerDown, true);
	});

	const promptBoxClass =
		'w-full rounded-xl border px-3 py-2.5 text-left text-sm leading-6 select-none';
</script>

{#snippet promptBody()}
	<span class="prompt-clamp-body" data-prompt-body>
		<InlinePromptContent
			text={item.text}
			attachments={item.attachments ?? []}
			issueReferences={item.issueReferences ?? []}
			transcriptReferences={item.transcriptReferences ?? []}
			elementReferences={item.elementReferences ?? []}
			onopenimage={transcript.openImageGallery}
		/>
	</span>
{/snippet}

<div
	class="sticky-prompt-fade bg-surface-root sticky top-0 z-40 -mx-3 mb-3.5 flex w-[calc(100%+1.5rem)] flex-col items-start gap-1.5"
	data-prompt-row
	data-latest-message={isLastRun && item.key === transcript.firstUserKey(run) ? 'true' : undefined}
	use:promptArrival={{ key: item.text, resumeOnly: run.runId !== transcript.submittedRunId }}
>
	{#if editing}
		<form
			bind:this={editorEl}
			class="w-full"
			data-testid="chat-message-editor"
			onsubmit={(event) => {
				event.preventDefault();
				checkpointEdit.submitCheckpointEdit(item);
			}}
		>
			<ComposerShell
				accent={transcript.composerControls?.profile.mode === 'plan'}
				testId="chat-message-editor-shell"
				footerTestId="chat-message-editor-toolbar"
				mode={transcript.composerControls?.profile.mode ?? 'agent'}
			>
				<Textarea
					bind:element={checkpointEdit.element}
					bind:value={checkpointEdit.editingPrompt}
					bare
					rows={1}
					textareaClass="block w-full overflow-hidden border-0 bg-transparent px-3 py-2.5 text-sm leading-6 select-text"
					ariaLabel="Edit message"
					disabled={submitting}
					oninput={checkpointEdit.autosizeCheckpointEditor}
					onkeydown={(event) => {
						if (event.key === 'Escape') checkpointEdit.cancelCheckpointEdit();
						if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							checkpointEdit.submitCheckpointEdit(item);
						}
					}}
				/>
				{#if checkpointEdit.checkpointEditError}
					<p class="text-error-content px-3 pb-2 text-xs" role="alert">
						{checkpointEdit.checkpointEditError}
					</p>
				{/if}
				{#if checkpointEdit.isArmed(item)}
					<div class="px-3 pb-2">
						<div
							class="border-error-content/25 bg-error text-2xs text-error-content flex items-start gap-2 rounded-lg border-[0.5px] px-2.5 py-2 leading-relaxed"
							role="alert"
							data-testid="chat-message-edit-confirm"
						>
							<Icon name="warning" size={14} class="mt-px shrink-0" />
							<span>{checkpointRestoreWarning(checkpointEdit.armedCheckpointChangeCount)}</span>
						</div>
					</div>
				{/if}

				{#snippet footer()}
					{@const controls = transcript.composerControls}
					<div class="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
						{#if controls}
							<ModelProfilePicker
								model={controls.model}
								disabled={controls.backendSelectionDisabled || submitting}
								onchange={controls.onbackendchange}
							/>
							<RunProfileControls
								model={controls.model}
								profile={controls.profile}
								disabled={submitting}
								onchange={controls.onprofilechange}
							/>
							<ModelDefaultsSettings
								defaults={controls.modelDefaults}
								rememberedModels={controls.rememberedModels}
								disabled={submitting}
								isRunning={controls.isRunning}
								onchange={controls.onmodelsettingschange}
							/>
						{/if}
					</div>

					<div class="flex shrink-0 items-center gap-1">
						{#if controls}
							<SessionRuntimeControls
								envelopes={controls.envelopes}
								sessionId={transcript.sessionId}
							/>
						{/if}
						{#if checkpointEdit.isArmed(item)}
							<Button
								variant="ghost"
								size="sm"
								disabled={submitting}
								onclick={checkpointEdit.disarmCheckpointEdit}
							>
								Keep editing
							</Button>
							<Tooltip content={OPEN_RUN_BLOCKS_RESTORE} placement="top" suppressed={!blocked}>
								<Button
									type="submit"
									variant="primary"
									size="sm"
									disabled={!canSend}
									ariaBusy={submitting}
									data-testid="chat-message-edit-confirm-send"
								>
									{submitting ? 'Sending…' : 'Discard and send'}
								</Button>
							</Tooltip>
						{:else}
							<Tooltip
								content={blocked ? OPEN_RUN_BLOCKS_RESTORE : 'Send edited message'}
								placement="top"
							>
								<IconButton
									variant="primary"
									size="md"
									type="submit"
									disabled={!canSend}
									class="active:scale-95"
									ariaLabel="Send edited message"
									data-testid="chat-message-edit-send"
								>
									<Icon name="arrow-up" size={16} />
								</IconButton>
							</Tooltip>
						{/if}
					</div>
				{/snippet}
			</ComposerShell>
		</form>
	{:else}
		{#if editable}
			<div
				class={[
					promptBoxClass,
					'prompt-clamp group/prompt bg-surface-50 border-surface-50-border text-fg-default hover:bg-surface-50-hover focus-visible:ring-button-primary/40 cursor-pointer focus-visible:ring-2 focus-visible:outline-none',
				]}
				data-message-kind="user"
				data-testid="chat-message-bubble-user"
				role="button"
				tabindex="0"
				aria-label={`Edit message: ${item.text}`}
				onclick={(event) => checkpointEdit.requestCheckpointEdit(item, event.target)}
				onkeydown={(event) => {
					if (event.key !== 'Enter' && event.key !== ' ') return;
					event.preventDefault();
					checkpointEdit.requestCheckpointEdit(item, event.target);
				}}
				use:clampPrompt
			>
				{@render promptBody()}
			</div>
		{:else}
			<div
				class={[
					promptBoxClass,
					'prompt-clamp group/prompt bg-surface-50 border-surface-50-border text-fg-default',
				]}
				data-message-kind="user"
				data-testid="chat-message-bubble-user"
				use:clampPrompt
			>
				{@render promptBody()}
			</div>
		{/if}
	{/if}
	<ChatPromptChips
		text={item.text}
		contextFiles={item.contextFiles ?? []}
		attachments={item.attachments ?? []}
		issueReferences={item.issueReferences ?? []}
		elementReferences={item.elementReferences ?? []}
		onopenimage={transcript.openImageGallery}
	/>
</div>
