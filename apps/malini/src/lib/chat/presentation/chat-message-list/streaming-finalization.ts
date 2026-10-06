export function blockKey(ownerSessionId: string, runId: string, contentId: string): string {
	return `${ownerSessionId}:${runId}:${contentId}`;
}

export function toolInputKey(runId: string, toolCallId: string): string {
	return `${runId}:${toolCallId}`;
}
