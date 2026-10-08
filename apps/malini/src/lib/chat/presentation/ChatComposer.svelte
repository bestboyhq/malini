<script lang="ts">
	import { page } from '$shared/router/state';
	import { tick, untrack } from 'svelte';
	import {
		claudeCodeStatusQuery,
		defaultAgentModel,
		isValidAgentModel,
		subscriptionBillingQuery,
		type AgentModel,
	} from '$shared/providers/providers.api';
	import type { ModelPreferences } from '$shared/providers/providers.api';
	import {
		ModelDefaultsSettings,
		ModelProfilePicker,
		RunProfileControls,
	} from '$shared/providers/providers.api';
	import { resetFreshSubmissionIntentCommand } from '$lib/chat/application/commands/reset-fresh-submission-intent.command';
	import { loadWorkstreamFilesCommand } from '$lib/chat/application/commands/load-workstream-files.command';
	import { pickAttachmentsCommand } from '$lib/chat/application/commands/pick-attachments.command';
	import { previewStagedAttachmentCommand } from '$lib/chat/application/commands/preview-staged-attachment.command';
	import { releaseImagePreviewsCommand } from '$lib/chat/application/commands/release-image-previews.command';
	import { detachAttachmentCommand } from '$lib/chat/application/commands/detach-attachment.command';
	import { reattachAttachmentsCommand } from '$lib/chat/application/commands/reattach-attachments.command';
	import { releaseDetachedAttachmentsCommand } from '$lib/chat/application/commands/release-detached-attachments.command';
	import { stageClipboardAttachmentsCommand } from '$lib/chat/application/commands/stage-clipboard-attachments.command';
	import { submitComposerPromptCommand } from '$lib/chat/application/commands/submit-composer-prompt.command';
	import { updateDraftCommand } from '$lib/chat/application/commands/update-draft.command';
	import { composerDraftQuery } from '$lib/chat/application/queries/composer-draft.query.svelte';
	import { composerDraftRestorationQuery } from '$lib/chat/application/queries/composer-draft-restoration.query.svelte';
	import { composerPendingSubmissionsQuery } from '$lib/chat/application/queries/composer-pending-submissions.query.svelte';
	import { chatRequestQuery } from '$lib/chat/application/queries/chat-request.query.svelte';
	import { imagePreviewQuery } from '$lib/chat/application/queries/image-preview.query.svelte';
	import { workstreamFileListingQuery } from '$lib/chat/application/queries/workstream-file-listing.query.svelte';
	import { newChatRequestId, type ChatRequestId } from '$lib/chat/domain/chat-request';
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
	import type { AgentComposerFileAttachment } from '$lib/chat/domain/composer-actions';
	import type { AgentElementReference } from '$lib/chat/domain/element-reference';
	import type { EventEnvelope } from '$lib/chat/domain/events';
	import type { AgentIssueReference } from '$lib/chat/domain/issue-reference';
	import type { SessionId } from '$lib/chat/domain/session';
	import type { AgentTranscriptReference } from '$lib/chat/domain/transcript-reference';
	import { elementReferenceKey, elementReferenceLabel } from '$lib/chat/domain/element-reference';
	import {
		parseAgentIssueReferenceUrl,
		sanitizeAgentIssueReferences,
	} from '$lib/chat/domain/issue-reference';
	import { elementChipId, type PromptChipRef } from '$lib/chat/domain/prompt-chip';
	import { promptChipPreview } from './prompt-editor/prompt-chip-preview';
	import type { ClipboardAttachmentCandidate } from './prompt-editor/clipboard-attachments';
	import { Button } from '$hyper-ui/components/button';
	import { ComposerShell } from '$hyper-ui/components/composer-shell';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { FileTypeIcon } from '$hyper-ui/components/file-type-icon';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { LoadingCircle } from '$hyper-ui/components/loading-circle';
	import { Sheet } from '$hyper-ui/components/sheet';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { avoidedByToasts } from '$hyper-ui/components/toast';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';

	import InlinePromptEditor, { type PromptChipDescriptor } from './InlinePromptEditor.svelte';
	import { arrivalMotion } from './arrival-motion';
	import SessionRuntimeControls from './SessionRuntimeControls.svelte';
	import { formatRunUsage, lastRunUsage } from './session-runtime-metadata';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import { describeFailure, sanitizeFailureDetail } from '$shared/errors/failure-copy';

	interface Props {
		sessionId?: SessionId | null;
		model: AgentModel;
		profile: AgentRunProfile;
		modelDefaults: ModelPreferences;
		rememberedModels: ModelPreferences;
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
		onmodelsettingschange?: (preferences: ModelPreferences) => void;
		onattachmentschange?: (attachments: readonly AgentComposerFileAttachment[]) => void;
	}

	let {
		sessionId = null,
		model = $bindable(),
		profile,
		modelDefaults,
		rememberedModels,
		envelopes = [],
		isRunning,
		forceFreshSession = false,
		disabled = false,
		backendSelectionDisabled = disabled,
		placeholder,
		oncancel,
		onbackendchange,
		onprofilechange,
		onmodelsettingschange,
		onattachmentschange,
		transcriptReferences = $bindable([]),
		elementReferences = $bindable([]),
	}: Props = $props();

	let prompt = $state('');
	let promptEditor: {
		focusEditor(options?: { scrollIntoView?: boolean }): void;
		insertChip(chip: PromptChipDescriptor): void;
		insertText(text: string): void;
	} | null = $state(null);

	export function focus(options?: { scrollIntoView?: boolean }): boolean {
		if (disabled || !promptEditor) return false;
		promptEditor.focusEditor(options);
		return true;
	}
	let contextTriggerEl: HTMLAnchorElement | HTMLButtonElement | null = $state(null);
	let addMenuOpen = $state(false);
	let localAttachments = $state<AgentComposerFileAttachment[]>([]);
	let localIssueReferences = $state<AgentIssueReference[]>([]);
	let attachmentRequests = $state<readonly AttachmentRequest[]>([]);
	const requestOutcome = $derived(chatRequestQuery.data);
	const imagePreview = $derived(imagePreviewQuery.data);
	let attachmentError = $state<string | null>(null);
	let issueSheetOpen = $state(false);
	let issueUrl = $state('');
	let issueSubmitting = $state(false);
	let issueError = $state<string | null>(null);
	const pendingSubmissionCount = $derived(composerPendingSubmissionsQuery.data);
	let outgoingBandEl: HTMLDivElement | null = null;
	let outgoingPrompts = $state(0);
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
	const resolvedPlaceholder = $derived(placeholder ?? 'Ask malini to make a change…');
	const runUsage = $derived(lastRunUsage(envelopes));

	const composerChips = $derived<PromptChipDescriptor[]>([
		...localAttachments.map((attachment) => ({
			kind: 'attachment' as const,
			id: attachment.id,
			label: attachment.displayName,
		})),
		...selectedContextFiles.map((path) => ({
			kind: 'context' as const,
			id: path,
			label: contextFileName(path),
		})),
		...localIssueReferences.map((reference) => ({
			kind: 'issue' as const,
			id: reference.url,
			label: reference.identifier,
		})),
		...transcriptReferences.map((reference) => ({
			kind: 'transcript' as const,
			id: reference.sessionId,
			label: reference.label,
		})),
		...elementReferences.map((reference) => ({
			kind: 'element' as const,
			id: elementChipId(reference.url, reference.domPath),
			label: elementReferenceLabel(reference),
		})),
	]);

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
			issueReferences: localIssueReferences,
			transcriptReferences,
			elementReferences,
			assetUrl: (relativePath) => {
				const staged = localAttachments.find(
					(attachment) => attachment.relativePath === relativePath,
				);
				if (!staged || !owner) return null;
				const preview = imagePreview(owner, staged.id);
				return preview?.status === 'ready' ? preview.src : null;
			},
		});
	}

	type AttachmentRequest = Readonly<{
		requestId: ChatRequestId;
		draftScope: string;
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
				if (outcome.status === 'failed') {
					attachmentError = outcome.error;
					continue;
				}
				if (request.draftScope !== draftScope) continue;
				localAttachments = readAttachmentDraft(draftScope);
				changed = true;
			}
			if (changed) onattachmentschange?.(localAttachments);
		});
	});

	function attachClipboardFiles(candidates: readonly ClipboardAttachmentCandidate[]): void {
		if (!workstreamId) return;
		const requestId = newChatRequestId();
		trackAttachmentRequest({ requestId, draftScope });
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
			case 'issue':
				return removeIssueReference(ref.id);
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

	function readIssueReferenceDraft(id: string): AgentIssueReference[] {
		return id
			? composerDraftQuery.data(id).issueReferences.map((reference) => ({ ...reference }))
			: [];
	}

	function writeIssueReferenceDraft(
		id: string,
		issueReferences: readonly AgentIssueReference[],
	): void {
		updateDraftCommand(id, { issueReferences });
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
		localIssueReferences = readIssueReferenceDraft(scope);
		transcriptReferences = readTranscriptReferenceDraft(scope);
		elementReferences = readElementReferenceDraft(scope);
		onattachmentschange?.(localAttachments);
		attachmentError = null;
		submissionError = null;
		addMenuOpen = false;
		issueSheetOpen = false;
		issueError = null;
		contextOpen = false;
		contextQuery = '';
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
		contextOpen = true;
		contextOpenedByTyping = byTyping;
		contextQuery = '';
		contextSelectionIndex = 0;
		await tick();
		contextSearchEl?.focus();
		loadWorkstreamFilesCommand(workstreamId);
	}

	function openNativeFilePicker(): void {
		addMenuOpen = false;
		const requestId = newChatRequestId();
		trackAttachmentRequest({ requestId, draftScope });
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

	function openIssueSheet(): void {
		addMenuOpen = false;
		issueUrl = '';
		issueError = null;
		issueSheetOpen = true;
	}

	function linkIssue(): void {
		const url = issueUrl.trim();
		if (!workstreamId || !url || issueSubmitting) return;
		const reference = parseAgentIssueReferenceUrl(url);
		if (!reference) {
			issueError = 'Enter a GitHub issue or Linear issue URL.';
			return;
		}
		issueSubmitting = true;
		try {
			localIssueReferences = sanitizeAgentIssueReferences([...localIssueReferences, reference]);
			writeIssueReferenceDraft(draftScope, localIssueReferences);
			issueSheetOpen = false;
			issueUrl = '';
			issueError = null;
		} finally {
			issueSubmitting = false;
		}
	}

	function removeIssueReference(url: string): void {
		localIssueReferences = localIssueReferences.filter((reference) => reference.url !== url);
		writeIssueReferenceDraft(draftScope, localIssueReferences);
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
			promptEditor?.focusEditor();
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
		prompt = `${prompt}${separator}@todos `;
		writeDraft(draftScope, prompt);
		contextOpenedByTyping = false;
		closeContextPicker();
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

	function isStandaloneMentionTrigger(event: KeyboardEvent): boolean {
		if (!(event.currentTarget instanceof HTMLDivElement)) return false;
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
		const caret = selection.getRangeAt(0);
		if (!event.currentTarget.contains(caret.commonAncestorContainer)) return false;
		const beforeCaret = caret.cloneRange();
		beforeCaret.selectNodeContents(event.currentTarget);
		beforeCaret.setEnd(caret.endContainer, caret.endOffset);
		const text = beforeCaret.toString();
		return text.length === 0 || /\s$/u.test(text);
	}

	function onKeydown(event: KeyboardEvent): void {
		if (
			event.key === '@' &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			isStandaloneMentionTrigger(event)
		) {
			event.preventDefault();
			void openContextPicker(true);
			return;
		}
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			submit();
		}
	}

	function playOutgoingPrompt(): void {
		const band = outgoingBandEl;
		const source = band?.querySelector('.prompt-editor-host');
		if (!band || !(source instanceof HTMLElement)) return;
		if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
		if (typeof source.animate !== 'function') return;
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

		const motion = arrivalMotion();
		const travel = sourceRect.bottom - bandRect.top;
		const animation = ghost.animate(
			[
				{ transform: 'translateY(0)', opacity: 1 },
				{ transform: `translateY(-${travel}px)`, opacity: 0 },
			],
			{ duration: motion.durationMs, easing: motion.easing, fill: 'forwards' },
		);
		const remove = (): void => {
			ghost.remove();
			outgoingPrompts -= 1;
		};
		void (async () => {
			await animation.finished.catch(() => undefined);
			remove();
		})();
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
		issueReferences: AgentIssueReference[];
		transcriptReferences: AgentTranscriptReference[];
		elementReferences: AgentElementReference[];
		profile: AgentRunProfile;
	}>;

	function submit(): void {
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
			issueReferences: localIssueReferences.map((reference) => ({ ...reference })),
			transcriptReferences: transcriptReferences.map((reference) => ({ ...reference })),
			elementReferences: elementReferences.map((reference) => ({
				...reference,
				rect: { ...reference.rect },
			})),
			profile: { ...profile },
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
				issueReferences: submission.issueReferences,
				transcriptReferences: submission.transcriptReferences,
				elementReferences: submission.elementReferences,
			})
		) {
			playOutgoingPrompt();
			prompt = '';
			selectedContextFiles = [];
			localAttachments = [];
			localIssueReferences = [];
			transcriptReferences = [];
			elementReferences = [];
			writeDraft(submission.draftScope, '');
			writeContextDraft(submission.draftScope, []);
			writeAttachmentDraft(submission.draftScope, []);
			writeIssueReferenceDraft(submission.draftScope, []);
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
				issueReferences: submission.issueReferences,
				transcriptReferences: submission.transcriptReferences,
				elementReferences: submission.elementReferences,
			},
		});
		queueMicrotask(() => promptEditor?.focusEditor());
	}

	function composerSnapshotIsCurrent(input: {
		workstreamId: string;
		prompt: string;
		contextFiles: readonly string[];
		attachments: readonly AgentComposerFileAttachment[];
		issueReferences: readonly AgentIssueReference[];
		transcriptReferences: readonly AgentTranscriptReference[];
		elementReferences: readonly AgentElementReference[];
	}): boolean {
		return workstreamTodoComposerSnapshotMatches(
			{
				workstreamId,
				prompt,
				contextFiles: selectedContextFiles,
				attachments: localAttachments,
				issueReferences: localIssueReferences,
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
		localIssueReferences = readIssueReferenceDraft(scope);
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

	const submitTitle = $derived(
		isRunning
			? 'Stop current run'
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
		open={addMenuOpen}
		anchor={contextTriggerEl}
		onclose={() => (addMenuOpen = false)}
		side="top"
		align="start"
		panelClass="w-56 rounded-lg border border-surface-elevated-border bg-surface-elevated p-1.5"
		testId="chat-add-menu"
		backdropTestId="chat-add-menu-backdrop"
		owner="chat-composer"
	>
		<div role="menu" aria-label="Add to prompt" class="space-y-0.5">
			<Tooltip content="Choose files from this Mac" placement="right" class="w-full">
				<DropdownItem
					role="menuitem"
					focusOnHover={false}
					class="h-9 w-full gap-2.5 px-2.5 text-left font-normal"
					data-testid="chat-add-files"
					onclick={openNativeFilePicker}
				>
					<Icon name="paperclip" class="shrink-0" size={15} />
					Attach files
				</DropdownItem>
			</Tooltip>
			<Tooltip
				content="Reference files already in this workstream"
				placement="right"
				class="w-full"
			>
				<DropdownItem
					role="menuitem"
					focusOnHover={false}
					class="h-9 w-full gap-2.5 px-2.5 text-left font-normal"
					data-testid="chat-add-context"
					onclick={() => void openContextPicker()}
				>
					<Icon name="folder-search" class="shrink-0" size={15} />
					Workstream context
				</DropdownItem>
			</Tooltip>
			<Tooltip content="Link an issue to this prompt" placement="right" class="w-full">
				<DropdownItem
					role="menuitem"
					focusOnHover={false}
					class="h-9 w-full gap-2.5 px-2.5 text-left font-normal"
					data-testid="chat-link-issue"
					onclick={openIssueSheet}
				>
					<Icon name="hash" class="shrink-0" size={15} />
					Link issue
				</DropdownItem>
			</Tooltip>
		</div>
	</DropdownLayer>

	<DropdownLayer
		open={contextOpen}
		anchor={contextTriggerEl}
		onclose={() => closeContextPicker()}
		side="top"
		align="start"
		panelClass="w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-surface-elevated-border bg-surface-elevated"
		testId="chat-context-picker"
		backdropTestId="chat-context-backdrop"
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
					<Tooltip
						content="Reference this workstream's current todos"
						placement="right"
						class="w-full"
					>
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
					</Tooltip>
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
						<Tooltip content={`Attach ${file.path}`} placement="right" class="w-full">
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
						</Tooltip>
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
		<div bind:this={outgoingBandEl} class="relative overflow-hidden">
			<InlinePromptEditor
				bind:this={promptEditor}
				value={prompt}
				chips={composerChips}
				placeholder={resolvedPlaceholder}
				placeholderHidden={outgoingPrompts > 0}
				disabled={disabled || todoContextResolving}
				resolvePreview={resolveChipPreview}
				onvaluechange={onPromptValueChange}
				onchipremove={onChipRemove}
				onattachfiles={attachClipboardFiles}
				onkeydown={onKeydown}
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
				<Tooltip content="Add files, context, or an issue" placement="top" suppressed={addMenuOpen}>
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
				<ModelDefaultsSettings
					defaults={modelDefaults}
					{rememberedModels}
					{disabled}
					{isRunning}
					onchange={(preferences) => onmodelsettingschange?.(preferences)}
				/>
			</div>

			<div class="flex shrink-0 items-center gap-1">
				<SessionRuntimeControls {envelopes} {sessionId} />
				<Tooltip content={submitTitle} placement="top">
					<IconButton
						variant={isRunning ? 'secondary' : 'primary'}
						size="md"
						type={isRunning ? 'button' : 'submit'}
						disabled={isRunning ? disabled : !canSend}
						class={['active:scale-95', isRunning && 'bg-surface-50 hover:bg-error/10']}
						ariaBusy={submitting}
						ariaLabel={submitTitle}
						data-testid="chat-composer-submit"
						onclick={isRunning ? onCancelClick : () => undefined}
					>
						{#if isRunning}
							<Icon name="stop" size={12} class="text-error-content" />
						{:else}
							<Icon name="arrow-up" size={16} />
						{/if}
					</IconButton>
				</Tooltip>
			</div>
		{/snippet}
	</ComposerShell>

	<div class="flex h-6 justify-end">
		{#if runUsage}
			<Tooltip
				content="Tokens sent to the model and generated during the last run"
				placement="top"
				class="w-fit"
			>
				<p
					class="text-2xs flex h-6 items-center gap-1.5 px-1 tabular-nums select-none"
					data-testid="chat-run-usage"
				>
					<span class="text-fg-tertiary">Last run</span>
					<span class="text-fg-tertiary/60" aria-hidden="true">·</span>
					<span class="text-fg-tertiary">
						{formatRunUsage(runUsage, !subscriptionBillingQuery.data)}
					</span>
				</p>
			</Tooltip>
		{/if}
	</div>
</form>

<Sheet
	open={issueSheetOpen}
	title="Link an issue"
	description="Attach an issue reference to this prompt without changing the prompt text."
	onclose={() => (issueSheetOpen = false)}
	closeTitle="Close issue linker"
>
	<div class="space-y-3" data-testid="chat-issue-link-sheet">
		<TextInput
			id="chat-issue-url"
			label="Issue URL"
			bind:value={issueUrl}
			type="url"
			placeholder="https://linear.app/…"
			data-testid="chat-issue-url"
		/>
		<p class="text-fg-tertiary text-xs leading-5" data-testid="chat-issue-link-boundary">
			The URL goes to the agent as unverified context. The agent can look it up only when its GitHub
			or Linear tool reports connected; pending or signed-out tools are not treated as available.
		</p>
		{#if issueError}
			<p
				class="text-error-content flex items-start gap-1.5 text-xs leading-5"
				role="alert"
				data-testid="chat-issue-link-error"
			>
				<Icon name="alert" class="mt-0.5 shrink-0" size={14} />
				<span class="min-w-0">{sanitizeFailureDetail(issueError)}</span>
			</p>
		{/if}
		<div class="flex justify-end gap-2">
			<Button variant="ghost" size="sm" onclick={() => (issueSheetOpen = false)}>Cancel</Button>
			<Tooltip content="Add this issue reference" placement="top">
				<Button
					variant="primary"
					size="sm"
					class="font-normal"
					disabled={!issueUrl.trim() || issueSubmitting}
					ariaLabel="Link issue"
					ariaBusy={issueSubmitting}
					onclick={linkIssue}
				>
					Link issue
				</Button>
			</Tooltip>
		</div>
	</div>
</Sheet>
