import { open } from 'node:fs/promises';

const TAIL_BYTES = 4_096;
const MAX_LINE_LENGTH = 200;
const TERMINAL_ESCAPES = /\u001b\[[0-9;?]*[ -/]*[@-~]/gu;

export async function lastOutputLine(file: string): Promise<string> {
	const handle = await open(file, 'r');
	try {
		const { size } = await handle.stat();
		const length = Math.min(size, TAIL_BYTES);
		const { buffer } = await handle.read(Buffer.alloc(length), 0, length, size - length);
		return lastLine(buffer.toString('utf8'));
	} finally {
		await handle.close();
	}
}

export function lastLine(text: string): string {
	const lines = text
		.replace(TERMINAL_ESCAPES, '')
		.split(/\r\n|\r|\n/u)
		.map((candidate) => candidate.trim())
		.filter(Boolean);
	const line = lines.at(-1) ?? '';
	return line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH - 1)}…` : line;
}
