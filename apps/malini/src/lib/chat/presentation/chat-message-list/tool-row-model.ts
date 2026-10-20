import { toolDurationMs, type RenderItem, type ToolAggregate } from '../render-state';
import {
	toolActionKind,
	toolActivityLabel,
	toolDescriptionLabel,
	toolDisplayName,
} from '../tool-display-name';

export type ToolItem = Extract<RenderItem, { kind: 'tool' }>;

export function liveCommandText(input: unknown): string | null {
	if (!isRecord(input)) return null;
	const value = input['command'];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function commandFromTool(item: ToolItem): string | null {
	return liveCommandText(item.tool.input);
}

export function isCommandTool(item: ToolItem): boolean {
	return toolActionKind(item.tool.name, item.tool.input) === 'command';
}

export function displayNameFromTool(item: ToolItem): string {
	return toolDisplayName(item.tool.name, item.tool.input);
}

export function activityLabelFromTool(item: ToolItem): string {
	return toolActivityLabel(item.tool.name, item.tool.input, 'completed');
}

export function descriptionFromTool(item: ToolItem): string | null {
	return toolDescriptionLabel(item.tool.name, item.tool.input);
}

export function failureTextFromTool(item: ToolItem): string {
	return item.tool.error ?? `${displayNameFromTool(item)} failed`;
}

export function durationFromTool(tool: ToolAggregate): number | null {
	return toolDurationMs(tool);
}

export function truncatedOutputLength(tool: ToolAggregate): number | null {
	if (!('outputLength' in tool)) return null;
	const length = tool.outputLength;
	return typeof length === 'number' && length > 0 ? length : null;
}
