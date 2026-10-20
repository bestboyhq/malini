import type { FullToolOutput } from '$lib/chat/domain/full-tool-output';

class ToolOutputsAggregate {
	outputs: Readonly<Record<string, FullToolOutput>> = $state.raw({});

	set(key: string, output: FullToolOutput): void {
		this.outputs = { ...this.outputs, [key]: output };
	}

	has(key: string): boolean {
		return Object.hasOwn(this.outputs, key);
	}
}

export const toolOutputsAggregate = new ToolOutputsAggregate();
