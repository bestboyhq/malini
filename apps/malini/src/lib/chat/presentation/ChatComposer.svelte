<script lang="ts">
	import { page } from '$shared/router/state';
	import { tick, untrack } from 'svelte';
	import { workstreamImageUrl } from '$contract/workstream-images';
	import {
		claudeCodeStatusQuery,
		defaultAgentModel,
		isValidAgentModel,
		subscriptionBillingQuery,
		type AgentModel,
	} from '$shared/providers/providers.api';
	import { ModelProfilePicker, RunProfileControls } from '$shared/providers/providers.api';
	import { resetFreshSubmissionIntentCommand } from '$lib/chat/application/commands/reset-fresh-submission-intent.command';
	import { loadWorkstreamFilesCommand } from '$lib/chat/application/commands/load-workstream-files.command';
	import { pickAttachmentsCommand } from '$lib/chat/application/commands/pick-attachments.command';
	import { openAttachmentFileCommand } from '$lib/chat/application/commands/open-attachment-file.command';
	import { previewStagedAttachmentCommand } from '$lib/chat/application/commands/preview-staged-attachment.command';
	import { releaseImagePreviewsCommand } from '$lib/chat/application/commands/release-image-previews.command';
	import { detachAttachmentCommand } from '$lib/chat/application/commands/detach-attachment.command';
	import { reattachAttachmentsCommand } from '$lib/chat/application/commands/reattach-attachments.command';
	import { releaseDetachedAttachmentsCommand } from '$lib/chat/application/commands/release-detached-attachments.command';
	import { stageClipboardAttachmentsCommand } from '$lib/chat/application/commands/stage-clipboard-attachments.command';
	import { adoptPastedAttachmentsCommand } from '$lib/chat/application/commands/adopt-pasted-attachments.command';
	import { sendCommandPromptCommand } from '$lib/chat/application/commands/send-command-prompt.command';
	import { submitComposerPromptCommand } from '$lib/chat/application/commands/submit-composer-prompt.command';
	import { updateDraftCommand } from '$lib/chat/application/commands/update-draft.command';
	import { composerDraftQuery } from '$lib/chat/application/queries/composer-draft.query.svelte';
	import { composerDraftRestorationQuery } from '$lib/chat/application/queries/composer-draft-restoration.query.svelte';
	import { composerPendingSubmissionsQuery } from '$lib/chat/application/queries/composer-pending-submissions.query.svelte';
	import { pendingPromptQuery } from '$lib/chat/application/queries/pending-prompt.query.svelte';
	import { chatRequestQuery } from '$lib/chat/application/queries/chat-request.query.svelte';
	import { imagePreviewQuery } from '$lib/chat/application/queries/image-preview.query.svelte';
	import { workstreamFileListingQuery } from '$lib/chat/application/queries/workstream-file-listing.query.svelte';
	import { newChatRequestId, type ChatRequestId } from '$lib/chat/domain/chat-request';
	import { CLAUDE_CODE_COMMANDS } from '$lib/chat/domain/claude-code-commands';
	import { agentDraftScopeKey } from '$lib/chat/domain/draft';
	import { clearWorkstreamTodosResolutionCommand } from '$lib/chat/application/commands/clear-workstream-todos-resolution.command';
	import { resolveWorkstreamTodosCommand } from '$lib/chat/application/commands/resolve-workstream-todos.command';
	import { workstreamTodosResolutionQuery } from '$lib/chat/application/queries/workstream-todos-resolution.query.svelte';
	import {
		promptReferencesWorkstreamTodos,
		workstreamTodoComposerSnapshotMatches,
		type WorkstreamTodosResolution,
	} from '$lib/chat/domain/workstream-todos';
	import type { AgentRunProfile } from '$shared/providers/providers.api';
	import {
		attachmentViewer,
		isVideoAttachment,
		type AgentComposerFileAttachment,
	} from '$lib/chat/domain/composer-actions';
	import type { AgentElementReference } from '$lib/chat/domain/element-reference';
	import type { EventEnvelope } from '$lib/chat/domain/events';
	import type { SessionId } from '$lib/chat/domain/session';
	import type { AgentTranscriptReference } from '$lib/chat/domain/transcript-reference';
	import { elementReferenceKey } from '$lib/chat/domain/element-reference';
	import { foreignAttachmentIds, type PromptChipRef } from '$lib/chat/domain/prompt-chip';
	import { promptChipPreview } from './prompt-editor/prompt-chip-preview';
	import type { ClipboardAttachmentCandidate } from './prompt-editor/clipboard-attachments';
	import { ComposerShell } from '$hyper-ui/components/composer-shell';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { FileTypeIcon } from '$hyper-ui/components/file-type-icon';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { LoadingCircle } from '$hyper-ui/components/loading-circle';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { avoidedByToasts } from '$hyper-ui/components/toast';
	import { setOverlayFocusReturn } from '$hyper-ui/overlay';
	import { EnterShortcut } from '$hyper-ui/components/enter-shortcut';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { JobPicker } from '$lib/jobs/jobs.api';

	import InlinePromptEditor, { type PromptChipDescriptor } from './InlinePromptEditor.svelte';
	import ImageGallery from './ImageGallery.svelte';
	import { attachmentGalleryImage, isGalleryAttachment } from './transcript-gallery';
	import { arrivalMotion } from './arrival-motion';
	import { stepGlideSpring, type GlideState } from './scroll-glide';
	import { draftChipDescriptors } from './inline-prompt-chips';
	import SessionRuntimeControls from './SessionRuntimeControls.svelte';
	import { formatRunUsage } from './session-runtime-metadata';
	import { TranscriptFactsProjector } from './transcript-facts';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import { describeFailure, sanitizeFailureDetail } from '$shared/errors/failure-copy';

	interface Props {
		sessionId?: SessionId | null;
		model: AgentModel;
		profile: AgentRunProfile;
		envelopes?: readonly EventEnvelope[];
		isRunning: boolean;
		forceFreshSession?: boolean;
		disabled?: boolean;
		backendSelectionDisabled?: boolean;
		placeholder?: string;
		transcriptReferences?: AgentTranscriptReference[];
		elementReferences?: AgentElementReference[];
		oncancel?: () => void;
		onbackendchange?: (model: AgentModel) => void;
		onprofilechange?: (profile: AgentRunProfile) => void;
		onattachmentschange?: (attachments: readonly AgentComposerFileAttachment[]) => void;
	}

	let {
		sessionId = null,
		model = $bindable(),
		profile,
		envelopes = [],
		isRunning,
		forceFreshSession = false,
		disabled = false,
		backendSelectionDisabled = disabled,
		placeholder,
		oncancel,
		onbackendchange,
		onprofilechange,
		onattachmentschange,
		transcriptReferences = $bindable([]),
		elementReferences = $bindable([]),
	}: Props = $props();

	let prompt = $state('');
	let promptEditor: {
		focusEditor(options?: { scrollIntoView?: boolean }): void;
		focusNow(options?: { atEnd?: boolean }): void;
		insertChip(chip: PromptChipDescriptor): void;
		insertText(text: string): void;
		paste(event: ClipboardEvent): void;
		beginTrigger(char: string): void;
		endTrigger(): void;
		removeTrigger(): void;
	} | null = $state(null);
	let jobPicker: {
		keydown(event: KeyboardEvent): void;
		activeOptionId(): string | undefined;
	} | null = $state(null);

	export function focus(options?: { scrollIntoView?: boolean }): boolean {
		if (disabled || !promptEditor) return false;
		promptEditor.focusEditor(options);
		return true;
	}

	setOverlayFocusReturn(() => {
		if (disabled || !promptEditor) return false;
		promptEditor.focusNow();
		return true;
	});

	export function typeKey(event: KeyboardEvent): void {
		if (disabled || !promptEditor) return;
		promptEditor.focusNow({ atEnd: true });
		onKeydown(event);
	}

	export function paste(event: ClipboardEvent): void {
		if (disabled || !promptEditor) return;
		promptEditor.focusNow({ atEnd: true });
		promptEditor.paste(event);
	}
	let contextTriggerEl: HTMLAnchorElement | HTMLButtonElement | null = $state(null);
	let addMenuOpen = $state(false);
	let localAttachments = $state<AgentComposerFileAttachment[]>([]);
	let attachmentRequests = $state<readonly AttachmentRequest[]>([]);
	const requestOutcome = $derived(chatRequestQuery.data);
	const imagePreview = $derived(imagePreviewQuery.data);
	let attachmentError = $state<string | null>(null);
	const pendingSubmissionCount = $derived(composerPendingSubmissionsQuery.data);
	let outgoingBandEl: HTMLDivElement | null = $state(null);
	let outgoingPrompts = $state(0);
	let landOutgoingPrompt: (() => void) | null = null;
	const claudeCodeStatus = $derived(claudeCodeStatusQuery.data);
	const agentUsable = $derived(
		claudeCodeStatus.kind !== 'missing' && claudeCodeStatus.kind !== 'signed-out',
	);
	let submissionError = $state<string | null>(null);
	let contextOpen = $state(false);
	let contextQuery = $state('');
	let contextSearchEl: HTMLInputElement | null = $state(null);
	let contextSelectionIndex = $state(0);
	let contextOpenedByTyping = $state(false);
	let jobPickerOpen = $state(false);
	let jobQuery = $state<string | null>(null);
	const jobPickerShown = $derived(jobPickerOpen || jobQuery !== null);
	let selectedContextFiles = $state<string[]>([]);
	const todosResolution = $derived(workstreamTodosResolutionQuery.data);
	const todoContextResolving = $derived(todosResolution?.status === 'resolving');
	let pendingTodoSubmission: Readonly<{ requestId: string; submission: ComposerDelivery }> | null =
		null;
	const MAX_CONTEXT_FILES = 20;
	const submitting = $derived(pendingSubmissionCount > 0);

	const canSend = $derived(
		prompt.trim() !== '' && !disabled && agentUsable && !todoContextResolving,
	);
	const resolvedPlaceholder = $derived(placeholder ?? 'Ask Malini to make a change…');
	const transcriptFactsProjector = new TranscriptFactsProjector();
	const transcriptFacts = $derived(transcriptFactsProjector.project(envelopes));
	const runUsage = $derived(transcriptFacts.lastRunUsage);

	const composerChips = $derived<PromptChipDescriptor[]>(
		draftChipDescriptors({
			attachments: localAttachments,
			contextFiles: selectedContextFiles,
			transcriptReferences,
			elementReferences,
		}),
	);

	let attachmentPreviewOwner = $state<string | null>(null);

	$effect(() => {
		if (!workstreamId) return;
		const owner = newChatRequestId();
		attachmentPreviewOwner = owner;
		return () => {
			attachmentPreviewOwner = null;
			releaseImagePreviewsCommand(owner);
		};
	});

	function resolveChipPreview(ref: PromptChipRef) {
		const owner = attachmentPreviewOwner;
		if (owner && ref.kind === 'attachment') {
			const staged = localAttachments.find((attachment) => attachment.id === ref.id);
			if (staged) previewStagedAttachmentCommand({ owner, workstreamId, attachment: staged });
		}
		return promptChipPreview(ref, {
			attachments: localAttachments,
			contextFiles: selectedContextFiles,
			transcriptReferences,
			elementReferences,
			assetUrl: (relativePath) => {
				const staged = localAttachments.find(
					(attachment) => attachment.relativePath === relativePath,
				);
				if (!staged || !owner) return null;
				if (isVideoAttachment(staged)) {
					return workstreamImageUrl(workstreamId, staged.relativePath, 0);
				}
				const preview = imagePreview(owner, staged.id);
				return preview?.status === 'ready' ? preview.src : null;
			},
		});
	}

	let galleryStartId = $state<string | null>(null);

	function chipOpener(ref: PromptChipRef): (() => void) | undefined {
		if (ref.kind !== 'attachment') return undefined;
		const attachment = localAttachments.find((candidate) => candidate.id === ref.id);
		if (!attachment) return undefined;
		switch (attachmentViewer(attachment)) {
			case 'gallery':
				return () => (galleryStartId = attachment.relativePath);
			case 'file-tab':
				return () => openAttachmentFileCommand(workstreamId, attachment);
			case null:
				return undefined;
		}
	}

	type AttachmentRequest = Readonly<{
		requestId: ChatRequestId;
		draftScope: string;
		adopting: readonly string[];
	}>;

	function trackAttachmentRequest(request: AttachmentRequest): void {
		attachmentError = null;
		attachmentRequests = [...attachmentRequests, request];
	}

	$effect(() => {
		const settled = attachmentRequests.flatMap((request) => {
			const outcome = requestOutcome(request.requestId);
			return outcome && outcome.status !== 'pending' ? [{ request, outcome }] : [];
		});
		if (settled.length === 0) return;
		untrack(() => {
			const settledIds = new Set(settled.map(({ request }) => request.requestId));
			attachmentRequests = attachmentRequests.filter(
				(request) => !settledIds.has(request.requestId),
			);
			let changed = false;
			for (const { request, outcome } of settled) {
				if (outcome.status === 'failed') attachmentError = outcome.error;
				if (request.draftScope !== draftScope) continue;
				if (request.adopting.length > 0) prompt = readDraft(draftScope);
				else if (outcome.status === 'failed') continue;
				localAttachments = readAttachmentDraft(draftScope);
				changed = true;
			}
			if (changed) onattachmentschange?.(localAttachments);
		});
	});

	function attachClipboardFiles(candidates: readonly ClipboardAttachmentCandidate[]): void {
		if (!workstreamId) return;
		const requestId = newChatRequestId();
		trackAttachmentRequest({ requestId, draftScope, adopting: [] });
		stageClipboardAttachmentsCommand({
			requestId,
			workstreamId,
			draftScope,
			files: candidates.map(({ fileName, file }) => ({ fileName, file })),
		});
	}

	function onChipRemove(ref: PromptChipRef): void | Promise<void> {
		switch (ref.kind) {
			case 'attachment':
				return detachNativeFile(ref.id);
			case 'context':
				return removeContextFile(ref.id);
			case 'transcript':
				return removeTranscriptReference(ref.id);
			case 'element':
				return removeElementReference(ref.id);
		}
	}

	const workstreamId = $derived(page.params.workstreamId ?? '');
	const contextListing = $derived(workstreamFileListingQuery.data(workstreamId));
	const contextFiles = $derived(contextListing?.status === 'ready' ? contextListing.files : []);
	const contextLoading = $derived(contextListing?.status === 'loading');
	const contextLoadError = $derived(
		contextListing?.status === 'failed' ? contextListing.error : null,
	);
	const contextFailure = $derived(
		contextLoadError ? describeFailure(contextLoadError, { subject: 'Workstream files' }) : null,
	);
	const draftScope = $derived(agentDraftScopeKey(workstreamId, sessionId));
	const jobChatSessionId = $derived(forceFreshSession ? null : sessionId);
	const slashCommands = $derived(jobQuery !== null && jobChatSessionId ? CLAUDE_CODE_COMMANDS : []);
	const pendingPrompt = $derived(sessionId ? pendingPromptQuery.data(sessionId) : null);
	const jobChatAfterRunId = $derived(pendingPrompt?.runId || transcriptFacts.lastRunId);

	function readDraft(id: string): string {
		return id ? composerDraftQuery.data(id).text : '';
	}

	function writeDraft(id: string, value: string): void {
		updateDraftCommand(id, { text: value });
	}

	function readContextDraft(id: string): string[] {
		return id ? [...composerDraftQuery.data(id).contextFiles] : [];
	}

	function writeContextDraft(id: string, files: readonly string[]): void {
		updateDraftCommand(id, { contextFiles: files });
	}

	function readAttachmentDraft(id: string): AgentComposerFileAttachment[] {
		return id
			? composerDraftQuery.data(id).attachments.map((attachment) => ({ ...attachment }))
			: [];
	}

	function writeAttachmentDraft(
		id: string,
		attachments: readonly AgentComposerFileAttachment[],
	): void {
		updateDraftCommand(id, { attachments });
	}

	function readTranscriptReferenceDraft(id: string): AgentTranscriptReference[] {
		return id
			? composerDraftQuery.data(id).transcriptReferences.map((reference) => ({ ...reference }))
			: [];
	}

	function writeTranscriptReferenceDraft(
		id: string,
		references: readonly AgentTranscriptReference[],
	): void {
		updateDraftCommand(id, { transcriptReferences: references });
	}

	function readElementReferenceDraft(id: string): AgentElementReference[] {
		return id
			? composerDraftQuery
					.data(id)
					.elementReferences.map((reference) => ({ ...reference, rect: { ...reference.rect } }))
			: [];
	}

	function writeElementReferenceDraft(
		id: string,
		references: readonly AgentElementReference[],
	): void {
		updateDraftCommand(id, { elementReferences: references });
	}

	function removeElementReference(key: string): void {
		elementReferences = elementReferences.filter(
			(reference) => elementReferenceKey(reference) !== key,
		);
		writeElementReferenceDraft(draftScope, elementReferences);
	}

	let restoredForScope = $state<string | null>(null);
	$effect.pre(() => {
		const scope = draftScope;
		if (!scope || scope === restoredForScope) return;
		resetFreshSubmissionIntentCommand();
		restoredForScope = scope;
		prompt = readDraft(scope);
		selectedContextFiles = readContextDraft(scope);
		localAttachments = readAttachmentDraft(scope);
		transcriptReferences = readTranscriptReferenceDraft(scope);
		elementReferences = readElementReferenceDraft(scope);
		onattachmentschange?.(localAttachments);
		attachmentError = null;
		submissionError = null;
		addMenuOpen = false;
		contextOpen = false;
		contextQuery = '';
		jobPickerOpen = false;
		jobQuery = null;
	});

	$effect(() => {
		if (!forceFreshSession) resetFreshSubmissionIntentCommand();
	});

	const draftRestoration = $derived(composerDraftRestorationQuery.data(draftScope));
	let draftRestorationBaseline: Readonly<{ scope: string; revision: number }> | null = null;

	$effect(() => {
		const scope = draftScope;
		const revision = draftRestoration;
		const baseline = draftRestorationBaseline;
		draftRestorationBaseline = { scope, revision };
		if (!baseline || baseline.scope !== scope || baseline.revision === revision) return;
		untrack(() => restoreFailedDraftInComposer(scope));
	});

	const filteredContextFiles = $derived.by(() => {
		const query = contextQuery.trim().toLowerCase();
		const selected = new Set(selectedContextFiles);
		const available = contextFiles.filter((entry) => !selected.has(entry.path));
		if (!query) return available.slice(0, 10);
		const terms = query.split(/\s+/).filter(Boolean);
		return available
			.filter((entry) => {
				const path = entry.path.toLowerCase();
				return terms.every((term) => path.includes(term));
			})
			.sort((left, right) => {
				const leftName = left.path.split('/').at(-1)?.toLowerCase() ?? left.path.toLowerCase();
				const rightName = right.path.split('/').at(-1)?.toLowerCase() ?? right.path.toLowerCase();
				const leftStarts = leftName.startsWith(query) ? 0 : 1;
				const rightStarts = rightName.startsWith(query) ? 0 : 1;
				return leftStarts - rightStarts || left.path.length - right.path.length;
			})
			.slice(0, 10);
	});
	const showTodosContext = $derived(
		contextQuery.trim() === '' || 'todos'.includes(contextQuery.trim().toLowerCase()),
	);
	const contextResultCount = $derived(filteredContextFiles.length + (showTodosContext ? 1 : 0));

	function contextFileName(path: string): string {
		return path.split('/').at(-1) || path;
	}

	function contextFileDirectory(path: string): string {
		const parts = path.split('/');
		parts.pop();
		return parts.join('/');
	}

	async function openContextPicker(byTyping = false): Promise<void> {
		if (disabled) return;
		addMenuOpen = false;
		closeJobPicker();
		contextOpen = true;
		contextOpenedByTyping = byTyping;
		contextQuery = '';
		contextSelectionIndex = 0;
		await tick();
		contextSearchEl?.focus();
		loadWorkstreamFilesCommand(workstreamId);
	}

	function openJobPicker(): void {
		if (disabled) return;
		addMenuOpen = false;
		contextOpen = false;
		jobPickerOpen = true;
	}

	function typeJobTrigger(): void {
		if (disabled) return;
		addMenuOpen = false;
		contextOpen = false;
		jobPickerOpen = false;
		promptEditor?.beginTrigger('/');
	}

	function closeJobPicker(): void {
		promptEditor?.endTrigger();
		jobQuery = null;
		jobPickerOpen = false;
	}

	function onJobPickerClose(): void {
		closeJobPicker();
		void (async () => {
			await tick();
			promptEditor?.focusEditor();
		})();
	}

	function onJobStarted(): void {
		if (jobQuery !== null) promptEditor?.removeTrigger();
		onJobPickerClose();
	}

	function runSlashCommand(name: string): void {
		const chatSessionId = jobChatSessionId;
		onJobStarted();
		if (!chatSessionId) return;
		sendCommandPromptCommand({
			workstreamId,
			sessionId: chatSessionId,
			prompt: `/${name}`,
			subject: 'Command',
		});
	}

	function openNativeFilePicker(): void {
		addMenuOpen = false;
		const requestId = newChatRequestId();
		trackAttachmentRequest({ requestId, draftScope, adopting: [] });
		pickAttachmentsCommand({ requestId, workstreamId, draftScope });
	}

	function detachNativeFile(id: string): void {
		detachAttachmentCommand({ draftScope, attachmentId: id });
		syncAttachmentsFromDraft();
	}

	function syncAttachmentsFromDraft(): void {
		localAttachments = readAttachmentDraft(draftScope);
		onattachmentschange?.(localAttachments);
	}

	function removeTranscriptReference(sessionId: string): void {
		transcriptReferences = transcriptReferences.filter(
			(reference) => reference.sessionId !== sessionId,
		);
		writeTranscriptReferenceDraft(draftScope, transcriptReferences);
	}

	function closeContextPicker(returnFocus = true, restoreSuffix = ''): void {
		const wasTyping = contextOpenedByTyping;
		const query = contextQuery;
		contextOpen = false;
		contextQuery = '';
		contextSelectionIndex = 0;
		contextOpenedByTyping = false;
		if (!returnFocus) return;
		if (wasTyping) {
			promptEditor?.insertText(`@${query}${restoreSuffix}`);
			return;
		}
		void (async () => {
			await tick();
			promptEditor?.focusNow();
		})();
	}

	function addContextFile(path: string): void {
		if (selectedContextFiles.includes(path) || selectedContextFiles.length >= MAX_CONTEXT_FILES) {
			return;
		}
		selectedContextFiles = [...selectedContextFiles, path];
		writeContextDraft(draftScope, selectedContextFiles);
		contextOpenedByTyping = false;
		closeContextPicker();
	}

	function addTodosContext(): void {
		const separator = prompt.length > 0 && !/\s$/u.test(prompt) ? ' ' : '';
		contextOpenedByTyping = false;
		closeContextPicker();
		promptEditor?.insertText(`${separator}@todos `);
	}

	function removeContextFile(path: string): void {
		selectedContextFiles = selectedContextFiles.filter((entry) => entry !== path);
		writeContextDraft(draftScope, selectedContextFiles);
	}

	function onContextSearchKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			closeContextPicker();
			return;
		}
		if (event.key === ' ' && contextOpenedByTyping) {
			event.preventDefault();
			closeContextPicker(true, ' ');
			return;
		}
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			contextSelectionIndex = Math.min(
				contextSelectionIndex + 1,
				Math.max(0, contextResultCount - 1),
			);
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			contextSelectionIndex = Math.max(0, contextSelectionIndex - 1);
			return;
		}
		if (event.key === 'Enter') {
			if (showTodosContext && contextSelectionIndex === 0) {
				event.preventDefault();
				addTodosContext();
				return;
			}
			const selected = filteredContextFiles[contextSelectionIndex - (showTodosContext ? 1 : 0)];
			if (!selected) return;
			event.preventDefault();
			addContextFile(selected.path);
		}
	}

	function isStandaloneMentionTrigger(): boolean {
		const editorEl = document.activeElement;
		if (!(editorEl instanceof HTMLDivElement)) return false;
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
		const caret = selection.getRangeAt(0);
		if (!editorEl.contains(caret.commonAncestorContainer)) return false;
		const beforeCaret = caret.cloneRange();
		beforeCaret.selectNodeContents(editorEl);
		beforeCaret.setEnd(caret.endContainer, caret.endOffset);
		const text = beforeCaret.toString();
		return text.length === 0 || /\s$/u.test(text);
	}

	function opensPicker(event: KeyboardEvent, key: string): boolean {
		return (
			event.key === key &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			isStandaloneMentionTrigger()
		);
	}

	function onKeydown(event: KeyboardEvent): void {
		if (jobQuery !== null) jobPicker?.keydown(event);
		if (event.defaultPrevented) return;
		if (opensPicker(event, '@')) {
			event.preventDefault();
			void openContextPicker(true);
			return;
		}
		if (opensPicker(event, '/')) {
			event.preventDefault();
			typeJobTrigger();
			return;
		}
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			submit(event.metaKey || event.ctrlKey);
		}
	}

	function playOutgoingPrompt(): void {
		const band = outgoingBandEl;
		const source = band?.querySelector('.prompt-editor-host');
		if (!band || !(source instanceof HTMLElement)) return;
		if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
		const sourceRect = source.getBoundingClientRect();
		const bandRect = band.getBoundingClientRect();
		if (sourceRect.height <= 0) return;

		const ghost = source.cloneNode(true);
		if (!(ghost instanceof HTMLElement)) return;
		ghost.setAttribute('aria-hidden', 'true');
		for (const editable of ghost.querySelectorAll('[contenteditable]')) {
			editable.setAttribute('contenteditable', 'false');
			editable.setAttribute('tabindex', '-1');
		}

		for (const node of [ghost, ...ghost.querySelectorAll('*')]) {
			for (const attribute of [
				'id',
				'data-testid',
				'aria-label',
				'aria-disabled',
				'aria-multiline',
				'role',
			]) {
				node.removeAttribute(attribute);
			}
		}
		ghost.style.position = 'absolute';
		ghost.style.left = `${sourceRect.left - bandRect.left}px`;
		ghost.style.top = `${sourceRect.top - bandRect.top}px`;
		ghost.style.width = `${sourceRect.width}px`;
		ghost.style.pointerEvents = 'none';
		ghost.style.userSelect = 'none';
		band.appendChild(ghost);
		outgoingPrompts += 1;
		void (async () => {
			await tick();
			flyOutgoingPrompt(band, ghost, bandRect.height, sourceRect.bottom - bandRect.top);
		})();
	}

	function flyOutgoingPrompt(
		band: HTMLElement,
		ghost: HTMLElement,
		fromPx: number,
		travelPx: number,
	): void {
		landOutgoingPrompt?.();
		band.style.height = '';
		const foldPx = Math.max(0, fromPx - band.getBoundingClientRect().height);
		let glide: GlideState = { position: 0, velocity: 0 };
		let previousFrameMs: number | null = null;
		let frame: number | null = null;
		const paint = (): void => {
			const progress = glide.position / travelPx;
			ghost.style.transform = `translateY(${-glide.position}px)`;
			ghost.style.opacity = String(1 - progress);
			if (foldPx > 0) band.style.height = `${fromPx - foldPx * progress}px`;
		};
		const land = (): void => {
			if (frame !== null) cancelAnimationFrame(frame);
			ghost.remove();
			band.style.height = '';
			outgoingPrompts -= 1;
			landOutgoingPrompt = null;
		};
		const step = (nowMs: number): void => {
			const elapsedMs = previousFrameMs === null ? 0 : nowMs - previousFrameMs;
			previousFrameMs = nowMs;
			glide = stepGlideSpring(glide, travelPx, elapsedMs, arrivalMotion().glideStiffness);
			if (glide.position === travelPx) {
				land();
				return;
			}
			paint();
			frame = requestAnimationFrame(step);
		};
		landOutgoingPrompt = land;
		if (travelPx <= 0) {
			land();
			return;
		}
		paint();
		frame = requestAnimationFrame(step);
	}

	type ComposerDelivery = Readonly<{
		model: AgentModel;
		prompt: string;
		workstreamId: string;
		draftScope: string;
		sessionId: SessionId | null;
		forceFreshSession: boolean;
		contextFiles: string[];
		attachments: AgentComposerFileAttachment[];
		transcriptReferences: AgentTranscriptReference[];
		elementReferences: AgentElementReference[];
		profile: AgentRunProfile;
		steer: boolean;
	}>;

	function submit(steer = false): void {
		if (!canSend) {
			return;
		}
		const trimmed = prompt.trim();
		if (!trimmed) {
			return;
		}
		const next = isValidAgentModel(model) ? model : defaultAgentModel();
		model = next;
		const submission: ComposerDelivery = {
			model: next,
			prompt,
			workstreamId,
			draftScope,
			sessionId,
			forceFreshSession,
			contextFiles: [...selectedContextFiles],
			attachments: localAttachments.map((attachment) => ({ ...attachment })),
			transcriptReferences: transcriptReferences.map((reference) => ({ ...reference })),
			elementReferences: elementReferences.map((reference) => ({
				...reference,
				rect: { ...reference.rect },
			})),
			profile: { ...profile },
			steer,
		};
		submissionError = null;
		if (!promptReferencesWorkstreamTodos(trimmed)) {
			deliver(submission, trimmed);
			return;
		}
		const requestId = newChatRequestId();
		pendingTodoSubmission = { requestId, submission };
		resolveWorkstreamTodosCommand({
			requestId,
			workstreamId: submission.workstreamId,
			prompt: trimmed,
		});
	}

	$effect(() => {
		const resolution = todosResolution;
		untrack(() => continueTodoSubmission(resolution));
	});

	function continueTodoSubmission(resolution: WorkstreamTodosResolution | null): void {
		const pending = pendingTodoSubmission;
		if (!pending || resolution?.requestId !== pending.requestId) return;
		if (resolution.status === 'resolving') return;
		pendingTodoSubmission = null;
		clearWorkstreamTodosResolutionCommand(resolution.requestId);
		if (resolution.status === 'failed') {
			submissionError = resolution.error;
			return;
		}
		if (workstreamId !== pending.submission.workstreamId) {
			submissionError = 'Workstream changed while todos were loading';
			return;
		}
		deliver(pending.submission, resolution.prompt);
	}

	function deliver(submission: ComposerDelivery, deliveredPrompt: string): void {
		submissionError = null;
		if (
			composerSnapshotIsCurrent({
				workstreamId: submission.workstreamId,
				prompt: submission.prompt,
				contextFiles: submission.contextFiles,
				attachments: submission.attachments,
				transcriptReferences: submission.transcriptReferences,
				elementReferences: submission.elementReferences,
			})
		) {
			playOutgoingPrompt();
			prompt = '';
			selectedContextFiles = [];
			localAttachments = [];
			transcriptReferences = [];
			elementReferences = [];
			writeDraft(submission.draftScope, '');
			writeContextDraft(submission.draftScope, []);
			writeAttachmentDraft(submission.draftScope, []);
			writeTranscriptReferenceDraft(submission.draftScope, []);
			writeElementReferenceDraft(submission.draftScope, []);
			onattachmentschange?.([]);
			releaseDetachedAttachmentsCommand({
				workstreamId: submission.workstreamId,
				draftScope: submission.draftScope,
			});
		}
		submitComposerPromptCommand({
			draftScope: submission.draftScope,
			draftPrompt: submission.prompt,
			freshIntentKey: `${submission.workstreamId}:${submission.profile.mode}:${submission.model}`,
			request: {
				requestId: newChatRequestId(),
				workstreamId: submission.workstreamId,
				sessionId: submission.sessionId,
				forceFreshSession: submission.forceFreshSession,
				prompt: deliveredPrompt,
				model: submission.model,
				profile: submission.profile,
				contextFiles: submission.contextFiles,
				attachments: submission.attachments,
				transcriptReferences: submission.transcriptReferences,
				elementReferences: submission.elementReferences,
				...(submission.steer ? { steer: true } : {}),
			},
		});
		queueMicrotask(() => promptEditor?.focusEditor());
	}

	function composerSnapshotIsCurrent(input: {
		workstreamId: string;
		prompt: string;
		contextFiles: readonly string[];
		attachments: readonly AgentComposerFileAttachment[];
		transcriptReferences: readonly AgentTranscriptReference[];
		elementReferences: readonly AgentElementReference[];
	}): boolean {
		return workstreamTodoComposerSnapshotMatches(
			{
				workstreamId,
				prompt,
				contextFiles: selectedContextFiles,
				attachments: localAttachments,
				transcriptReferences,
				elementReferences,
			},
			input,
		);
	}

	function restoreFailedDraftInComposer(scope: string): void {
		prompt = readDraft(scope);
		selectedContextFiles = readContextDraft(scope);
		localAttachments = readAttachmentDraft(scope);
		transcriptReferences = readTranscriptReferenceDraft(scope);
		elementReferences = readElementReferenceDraft(scope);
		onattachmentschange?.(localAttachments);
		submissionError = 'Prompt could not be sent. Its complete draft was restored.';
		queueMicrotask(() => promptEditor?.focusEditor());
	}

	function onPromptValueChange(value: string): void {
		submissionError = null;
		prompt = value;
		writeDraft(draftScope, prompt);
		const attached = readAttachmentDraft(draftScope).length;
		reattachAttachmentsCommand({ draftScope, prompt: value });
		if (readAttachmentDraft(draftScope).length !== attached) syncAttachmentsFromDraft();
		adoptPastedAttachments(value);
	}

	function adoptPastedAttachments(value: string): void {
		const inFlight = new Set(attachmentRequests.flatMap((request) => request.adopting));
		const pasted = foreignAttachmentIds(value, readAttachmentDraft(draftScope)).filter(
			(id) => !inFlight.has(id),
		);
		if (!workstreamId || pasted.length === 0) return;
		const requestId = newChatRequestId();
		trackAttachmentRequest({ requestId, draftScope, adopting: pasted });
		adoptPastedAttachmentsCommand({ requestId, workstreamId, draftScope, attachmentIds: pasted });
	}

	function onCancelClick(): void {
		oncancel?.();
		promptEditor?.focusEditor();
	}

	function toggleAddMenu(): void {
		if (disabled) return;
		addMenuOpen = !addMenuOpen;
	}

	function selectBackend(nextModel: AgentModel): void {
		model = nextModel;
		onbackendchange?.(nextModel);
	}

	const stopsRun = $derived(isRunning && prompt.trim() === '');
	const queuesOnSend = $derived(isRunning && !stopsRun);
	const submitTitle = $derived(
		stopsRun
			? 'Stop current run'
			: isRunning
				? 'Queue prompt'
				: submitting
					? `Send prompt · ${pendingSubmissionCount} pending`
					: 'Send prompt',
	);
</script>

<form
	class="chat-column relative z-20 shrink-0 px-4 pb-1"
	{@attach avoidedByToasts}
	onsubmit={(event) => {
		event.preventDefault();
		submit();
	}}
	data-testid="chat-composer"
>
	<DropdownLayer
		role={null}
		open={addMenuOpen}
		anchor={contextTriggerEl}
		onclose={() => (addMenuOpen = false)}
		side="top"
		align="start"
		panelClass="w-56 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1.5"
		testId="chat-add-menu"
		owner="chat-composer"
	>
		<div role="menu" aria-label="Add to prompt" class="space-y-0.5">
			<DropdownItem
				role="menuitem"
				focusOnHover={false}
				class="gap-2.5"
				data-testid="chat-add-files"
				onclick={openNativeFilePicker}
			>
				<Icon name="paperclip" class="shrink-0" size={15} />
				Attach files
			</DropdownItem>
			<DropdownItem
				role="menuitem"
				focusOnHover={false}
				class="gap-2.5"
				data-testid="chat-add-context"
				onclick={() => void openContextPicker()}
			>
				<Icon name="folder-search" class="shrink-0" size={15} />
				Workstream context
			</DropdownItem>
			<div class="border-surface-elevated-border mx-1 my-1 border-t" role="separator"></div>
			<DropdownItem
				role="menuitem"
				focusOnHover={false}
				class="gap-2.5"
				data-testid="chat-run-job"
				onclick={openJobPicker}
			>
				<Icon name="checklist" class="shrink-0" size={15} />
				Run a job
			</DropdownItem>
		</div>
	</DropdownLayer>

	{#if jobPickerShown}
		<JobPicker
			bind:this={jobPicker}
			anchor={jobQuery === null ? contextTriggerEl : outgoingBandEl}
			typedQuery={jobQuery}
			{workstreamId}
			chatSessionId={jobChatSessionId}
			chatAfterRunId={jobChatAfterRunId}
			commands={slashCommands}
			onclose={onJobPickerClose}
			onstarted={onJobStarted}
			oncommand={runSlashCommand}
		/>
	{/if}

	<DropdownLayer
		open={contextOpen}
		anchor={contextTriggerEl}
		onclose={() => closeContextPicker()}
		side="top"
		align="start"
		panelClass="w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated"
		testId="chat-context-picker"
		owner="chat-composer"
		restoreFocusToAnchor={false}
	>
		<div role="dialog" aria-label="Add workstream context">
			<div class="border-surface-elevated-border flex items-center gap-2 border-b px-3 py-2.5">
				<Icon name="folder-search" class="text-fg-tertiary shrink-0" size={16} />
				<TextInput
					bind:element={contextSearchEl}
					bind:value={contextQuery}
					bare
					type="search"
					placeholder="Find a file or @todos"
					ariaLabel="Find workstream context"
					class="h-7 min-w-0 flex-1 text-sm"
					inputClass="[&::-webkit-search-cancel-button]:hidden"
					data-testid="chat-context-search"
					oninput={() => (contextSelectionIndex = 0)}
					onkeydown={onContextSearchKeydown}
				/>
				<kbd
					class="border-chip-border bg-chip text-2xs text-fg-tertiary rounded border px-1.5 py-0.5"
				>
					esc
				</kbd>
			</div>
			<div class="styled-scrollbar max-h-72 overflow-y-auto p-1.5">
				{#if showTodosContext}
					<DropdownItem
						selected={contextSelectionIndex === 0}
						focusOnHover={false}
						class="w-full gap-2.5 px-2.5 py-2 text-left"
						data-testid="chat-context-todos"
						onmouseenter={() => (contextSelectionIndex = 0)}
						onclick={addTodosContext}
					>
						<Icon name="hash" class="text-fg-tertiary shrink-0" size={15} />
						<span class="min-w-0 flex-1">
							<span class="block truncate text-xs font-medium">@todos</span>
							<span class="text-2xs text-fg-tertiary mt-0.5 block truncate">
								Current bounded workstream todo list
							</span>
						</span>
					</DropdownItem>
				{/if}
				{#if contextLoading}
					<div
						class="text-fg-tertiary flex items-center gap-2 px-2.5 py-3 text-xs"
						role="status"
						aria-live="polite"
						aria-label="Loading workstream files"
					>
						<Tooltip content="Loading workstream files" placement="top">
							<LoadingCircle class="text-fg-tertiary" size={14} />
						</Tooltip>
						Loading workstream files…
					</div>
				{:else if contextFailure}
					<StateBlock
						layout="inline"
						live="alert"
						class="px-2.5"
						tone={contextFailure.tone}
						heading={contextFailure.heading}
						detail={contextFailure.detail}
						remedy={contextFailure.remedy}
						technical={contextFailure.technical}
						testId="chat-context-error"
					/>
				{:else if filteredContextFiles.length === 0 && !showTodosContext}
					<StateBlock
						layout="inline"
						class="px-2.5"
						heading={selectedContextFiles.length >= MAX_CONTEXT_FILES
							? 'Context file limit reached'
							: 'No matching files'}
						detail={selectedContextFiles.length >= MAX_CONTEXT_FILES
							? `A prompt can carry at most ${MAX_CONTEXT_FILES} context files.`
							: 'Nothing in this workstream checkout matches what you typed.'}
						remedy={selectedContextFiles.length >= MAX_CONTEXT_FILES
							? 'Remove a file above to add a different one.'
							: 'Try a shorter path fragment, or paste the file contents instead.'}
						testId="chat-context-empty"
					/>
				{:else}
					{#each filteredContextFiles as file, index (file.path)}
						<DropdownItem
							selected={index + (showTodosContext ? 1 : 0) === contextSelectionIndex}
							focusOnHover={false}
							class="w-full gap-2.5 px-2.5 py-2 text-left"
							data-testid="chat-context-result"
							data-context-path={file.path}
							onmouseenter={() => (contextSelectionIndex = index + (showTodosContext ? 1 : 0))}
							onclick={() => addContextFile(file.path)}
						>
							<FileTypeIcon path={file.path} size={15} />
							<span class="min-w-0 flex-1">
								<span class="block truncate text-xs font-medium">
									{contextFileName(file.path)}
								</span>
								{#if contextFileDirectory(file.path)}
									<span class="text-2xs text-fg-tertiary mt-0.5 block truncate font-mono">
										{contextFileDirectory(file.path)}
									</span>
								{/if}
							</span>
						</DropdownItem>
					{/each}
				{/if}
			</div>
			<div
				class="border-surface-elevated-border text-2xs text-fg-tertiary flex items-center justify-end border-t px-3 py-2"
			>
				<span>{selectedContextFiles.length}/{MAX_CONTEXT_FILES} attached</span>
			</div>
		</div>
	</DropdownLayer>

	<ComposerShell
		accent={profile.mode === 'plan'}
		{disabled}
		testId="chat-composer-shell"
		footerTestId="chat-composer-toolbar"
		mode={profile.mode}
	>
		<div bind:this={outgoingBandEl} class="relative overflow-hidden" data-dropdown-anchor>
			<InlinePromptEditor
				bind:this={promptEditor}
				value={prompt}
				chips={composerChips}
				placeholder={resolvedPlaceholder}
				placeholderHidden={outgoingPrompts > 0}
				disabled={disabled || todoContextResolving}
				resolvePreview={resolveChipPreview}
				{chipOpener}
				onvaluechange={onPromptValueChange}
				onchipremove={onChipRemove}
				onattachfiles={attachClipboardFiles}
				ariaActiveDescendant={jobQuery === null ? undefined : jobPicker?.activeOptionId()}
				onkeydown={onKeydown}
				ontriggerquery={(query) => (jobQuery = query)}
			/>
		</div>

		{#if attachmentError}
			<p
				class="text-2xs text-error-content flex items-start gap-1.5 px-3 pb-2 leading-4"
				role="alert"
				data-testid="chat-attachment-error"
			>
				<Icon name="alert" class="mt-px shrink-0" size={13} />
				<span class="min-w-0">{sanitizeFailureDetail(attachmentError)}</span>
			</p>
		{/if}
		{#if submissionError}
			<p
				class="text-2xs text-error-content flex items-start gap-1.5 px-3 pb-2 leading-4"
				role="alert"
				data-testid="chat-submit-error"
			>
				<Icon name="alert" class="mt-px shrink-0" size={13} />
				<span class="min-w-0">{sanitizeFailureDetail(submissionError)}</span>
			</p>
		{/if}

		{#snippet footer()}
			<div class="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
				<Tooltip
					content="Add files, context, or run a job"
					placement="top"
					suppressed={addMenuOpen || contextOpen || jobPickerShown}
				>
					<IconButton
						bind:element={contextTriggerEl}
						variant="ghost"
						size="md"
						ariaLabel="Add to prompt"
						active={addMenuOpen}
						class="text-fg-tertiary hover:bg-surface-50 rounded-lg"
						data-testid="chat-context-open"
						onclick={toggleAddMenu}
					>
						<Icon name="plus" size={16} />
					</IconButton>
				</Tooltip>
				<ModelProfilePicker {model} disabled={backendSelectionDisabled} onchange={selectBackend} />
				<RunProfileControls
					{model}
					{profile}
					{disabled}
					onchange={(nextProfile) => onprofilechange?.(nextProfile)}
				/>
			</div>

			<div class="flex shrink-0 items-center gap-1">
				<SessionRuntimeControls {envelopes} {sessionId} />
				<Tooltip content={queuesOnSend ? queueOrSteerHelp : submitTitle} placement="top">
					<IconButton
						variant={stopsRun ? 'secondary' : 'primary'}
						size="md"
						type={stopsRun ? 'button' : 'submit'}
						disabled={stopsRun ? disabled : !canSend}
						class={['active:scale-95', stopsRun && 'bg-surface-50 hover:bg-error/10']}
						ariaBusy={submitting}
						ariaLabel={submitTitle}
						{...queuesOnSend ? { ariaKeyshortcuts: 'Enter Meta+Enter' } : {}}
						data-testid="chat-composer-submit"
						onclick={stopsRun ? onCancelClick : () => undefined}
					>
						{#if stopsRun}
							<Icon name="stop" size={12} class="text-error-content" />
						{:else}
							<Icon name="arrow-up" size={16} />
						{/if}
					</IconButton>
				</Tooltip>
			</div>
		{/snippet}
	</ComposerShell>

	{#snippet queueOrSteerHelp()}
		<span class="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-left">
			<span>Queue after this run</span>
			<EnterShortcut class="text-fg-tertiary justify-self-end" />
			<span>Steer now, interrupting it</span>
			<EnterShortcut mod class="text-fg-tertiary justify-self-end" />
		</span>
	{/snippet}

	<div class="flex h-6 justify-end px-3">
		{#if runUsage}
			<p
				class="text-2xs flex h-6 items-center gap-1.5 tabular-nums select-none"
				data-testid="chat-run-usage"
			>
				<span class="text-fg-tertiary">Last run</span>
				<span class="text-fg-tertiary/60" aria-hidden="true">·</span>
				<span class="text-fg-tertiary">
					{formatRunUsage(runUsage, !subscriptionBillingQuery.data)}
				</span>
			</p>
		{/if}
	</div>
</form>

{#if galleryStartId}
	<ImageGallery
		{workstreamId}
		images={localAttachments.filter(isGalleryAttachment).map(attachmentGalleryImage)}
		startId={galleryStartId}
		onclose={() => (galleryStartId = null)}
	/>
{/if}
