import { languageHintLabel } from '@malini/extension-api';
import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import {
	elementReferenceChipLines,
	elementReferenceLabel,
	type AgentElementReference,
} from '$lib/chat/domain/element-reference';
import type { AgentIssueProvider, AgentIssueReference } from '$lib/chat/domain/issue-reference';
import { parseElementChipId, type PromptChipRef } from '$lib/chat/domain/prompt-chip';
import type { AgentTranscriptReference } from '$lib/chat/domain/transcript-reference';

export type PromptChipPreview =
	| { kind: 'image'; title: string; src: string; meta: string }
	| { kind: 'file'; title: string; meta: string }
	| { kind: 'lines'; title: string; lines: readonly string[] }
	| { kind: 'code'; title: string; code: string; meta?: string }
	| null;

export type PromptChipPreviewSources = {
	attachments: readonly StagedAgentAttachment[];
	contextFiles: readonly string[];
	issueReferences: readonly AgentIssueReference[];
	transcriptReferences: readonly AgentTranscriptReference[];
	elementReferences: readonly AgentElementReference[];
	assetUrl?: (relativePath: string) => string | null;
};

const PROVIDER_LABELS: Readonly<Record<AgentIssueProvider, string>> = {
	github: 'GitHub',
	linear: 'Linear',
};

export function promptChipPreview(
	ref: PromptChipRef,
	sources: PromptChipPreviewSources,
): PromptChipPreview {
	switch (ref.kind) {
		case 'attachment':
			return attachmentPreview(ref.id, sources);
		case 'context':
			return contextPreview(ref.id, sources.contextFiles);
		case 'issue':
			return issuePreview(ref.id, sources.issueReferences);
		case 'transcript':
			return transcriptPreview(ref.id, sources.transcriptReferences);
		case 'element':
			return elementPreview(ref.id, sources.elementReferences);
	}
}

function attachmentPreview(id: string, sources: PromptChipPreviewSources): PromptChipPreview {
	const attachment = sources.attachments.find((candidate) => candidate.id === id);
	if (!attachment) return null;

	const meta = [formatBytes(attachment.size), fileKindLabel(attachment.displayName)]
		.filter(Boolean)
		.join(' · ');

	if (attachment.mediaType.startsWith('image/')) {
		const src = sources.assetUrl?.(attachment.relativePath) ?? null;
		if (src) return { kind: 'image', title: attachment.displayName, src, meta };
	}
	return { kind: 'file', title: attachment.displayName, meta };
}

function fileKindLabel(name: string): string | null {
	const dot = name.lastIndexOf('.');
	return dot === -1 ? null : languageHintLabel(name.slice(dot + 1));
}

function contextPreview(path: string, contextFiles: readonly string[]): PromptChipPreview {
	if (!contextFiles.includes(path)) return null;
	return { kind: 'file', title: basename(path), meta: path };
}

function issuePreview(
	url: string,
	issueReferences: readonly AgentIssueReference[],
): PromptChipPreview {
	const issue = issueReferences.find((candidate) => candidate.url === url);
	if (!issue) return null;

	return {
		kind: 'lines',
		title: `${PROVIDER_LABELS[issue.provider]} issue`,
		lines: [issue.identifier, issue.url],
	};
}

function transcriptPreview(
	sessionId: string,
	transcriptReferences: readonly AgentTranscriptReference[],
): PromptChipPreview {
	const transcript = transcriptReferences.find((candidate) => candidate.sessionId === sessionId);
	if (!transcript) return null;
	return { kind: 'lines', title: 'Transcript', lines: [transcript.label, transcript.sessionId] };
}

function elementPreview(
	id: string,
	elementReferences: readonly AgentElementReference[],
): PromptChipPreview {
	const parsed = parseElementChipId(id);
	if (!parsed) return null;
	const element = elementReferences.find(
		(candidate) => candidate.url === parsed.url && candidate.domPath === parsed.domPath,
	);
	if (!element) return null;

	const [domPathLine, positionLine, htmlLine] = elementReferenceChipLines(element);
	return {
		kind: 'code',
		title: elementReferenceLabel(element),
		code: htmlLine,
		meta: `${domPathLine} · ${positionLine}`,
	};
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
		value /= 1024;
		unit += 1;
	}

	const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/u, '');
	return `${rounded} ${BYTE_UNITS[unit]}`;
}

function basename(path: string): string {
	return path.split('/').filter(Boolean).pop() || path;
}
