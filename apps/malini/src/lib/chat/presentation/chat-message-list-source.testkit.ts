import { readFileSync, readdirSync } from 'node:fs';

const SHELL = 'ChatMessageList.svelte';
const PARTS_DIRECTORY = 'chat-message-list';

export function readChatMessageListSource(presentationDirectory: URL): string {
	const partsDirectory = new URL(`${PARTS_DIRECTORY}/`, presentationDirectory);
	const parts = readdirSync(partsDirectory)
		.filter((entry) => /\.(?:svelte|ts)$/u.test(entry) && !/\.test\.ts$/u.test(entry))
		.sort()
		.map((entry) => readFileSync(new URL(entry, partsDirectory), 'utf8'));
	return [readFileSync(new URL(SHELL, presentationDirectory), 'utf8'), ...parts].join('\n\n');
}
