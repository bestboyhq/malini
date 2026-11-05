import { createHash } from 'node:crypto';
import type {
	BetaBase64ImageSource,
	BetaBase64PDFSource,
	BetaContentBlock,
	BetaContentBlockParam,
	BetaMessage,
	BetaMessageDeltaUsage,
	BetaPlainTextSource,
	BetaRawContentBlockDelta,
	BetaRawContentBlockStartEvent,
	BetaRawMessageStreamEvent,
	BetaRedactedThinkingBlockParam,
	BetaStopReason,
	BetaTextBlockParam,
	BetaThinkingBlockParam,
	BetaTool,
	BetaToolResultBlockParam,
	BetaToolUseBlockParam,
	BetaURLImageSource,
	BetaURLPDFSource,
	BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type {
	EasyInputMessage,
	FunctionTool,
	ResponseCreateParamsStreaming,
	ResponseErrorEvent,
	ResponseFunctionCallArgumentsDeltaEvent,
	ResponseFunctionCallOutputItem,
	ResponseFunctionToolCall,
	ResponseInputContent,
	ResponseInputItem,
	ResponseReasoningItem,
	ResponseReasoningSummaryPartAddedEvent,
	ResponseReasoningSummaryTextDeltaEvent,
	ResponseRefusalDeltaEvent,
	ResponseStreamEvent,
	ResponseTextDeltaEvent,
	ResponseUsage,
	ToolChoiceFunction,
	ToolChoiceOptions,
} from 'openai/resources/responses/responses';
import { z } from 'zod';

const MAX_TOOL_NAME_LENGTH = 64;
const REASONING_SIGNATURE_PREFIX = 'malini-chatgpt-reasoning:';
const BILLING_HEADER_PREFIX = 'x-anthropic-billing-header:';

type Exhaustive<Missing extends never> = Missing;

const imageMediaType = z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const textBlock = z.object({
	type: z.literal('text'),
	text: z.string(),
}) satisfies z.ZodType<Pick<BetaTextBlockParam, 'type' | 'text'>>;

const imageSource = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('base64'),
		media_type: imageMediaType,
		data: z.string(),
	}) satisfies z.ZodType<BetaBase64ImageSource>,
	z.object({ type: z.literal('url'), url: z.string() }) satisfies z.ZodType<BetaURLImageSource>,
	z.object({ type: z.literal('file'), file_id: z.string() }),
]);

const imageBlock = z.object({ type: z.literal('image'), source: imageSource });

const documentSource = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('base64'),
		media_type: z.literal('application/pdf'),
		data: z.string(),
	}) satisfies z.ZodType<BetaBase64PDFSource>,
	z.object({
		type: z.literal('text'),
		media_type: z.literal('text/plain'),
		data: z.string(),
	}) satisfies z.ZodType<BetaPlainTextSource>,
	z.object({ type: z.literal('url'), url: z.string() }) satisfies z.ZodType<BetaURLPDFSource>,
	z.object({
		type: z.literal('content'),
		content: z.union([z.string(), z.array(z.union([textBlock, imageBlock]))]),
	}),
	z.object({ type: z.literal('file'), file_id: z.string() }),
]);

const documentBlock = z.object({
	type: z.literal('document'),
	source: documentSource,
	title: z.string().nullable().exactOptional(),
});

const thinkingBlock = z.object({
	type: z.literal('thinking'),
	thinking: z.string(),
	signature: z.string(),
}) satisfies z.ZodType<BetaThinkingBlockParam>;

const redactedThinkingBlock = z.object({
	type: z.literal('redacted_thinking'),
	data: z.string(),
}) satisfies z.ZodType<BetaRedactedThinkingBlockParam>;

const toolUseBlock = z.object({
	type: z.literal('tool_use'),
	id: z.string(),
	name: z.string(),
	input: z.unknown(),
}) satisfies z.ZodType<Pick<BetaToolUseBlockParam, 'type' | 'id' | 'name' | 'input'>>;

const toolReferenceBlock = z.object({ type: z.literal('tool_reference'), tool_name: z.string() });

const untranslatedResultBlock = z.object({ type: z.enum(['search_result', 'browser_state']) });

const toolResultBlock = z.object({
	type: z.literal('tool_result'),
	tool_use_id: z.string(),
	content: z
		.union([
			z.string(),
			z.array(
				z.discriminatedUnion('type', [
					textBlock,
					imageBlock,
					documentBlock,
					toolReferenceBlock,
					untranslatedResultBlock,
				]),
			),
		])
		.exactOptional(),
	is_error: z.boolean().exactOptional(),
}) satisfies z.ZodType<Pick<BetaToolResultBlockParam, 'type' | 'tool_use_id' | 'is_error'>>;

const toolDefinition = z.object({
	name: z.string(),
	description: z.string().exactOptional(),
	input_schema: z.record(z.string(), z.unknown()),
	defer_loading: z.boolean().exactOptional(),
	type: z.literal('custom').nullable().exactOptional(),
}) satisfies z.ZodType<Pick<BetaTool, 'name' | 'description' | 'defer_loading' | 'type'>>;

const toolChangeReference = z.discriminatedUnion('type', [
	z.object({ type: z.literal('tool_reference'), name: z.string() }),
	z.object({ type: z.literal('mcp_tool_reference'), name: z.string(), server_name: z.string() }),
	z.object({ type: z.literal('mcp_toolset_reference'), server_name: z.string() }),
]);

const toolAdditionBlock = z.object({
	type: z.literal('tool_addition'),
	tool: z.union([
		toolChangeReference,
		z.object({ type: z.literal('tool_definition'), definition: z.unknown() }),
	]),
});

const toolRemovalBlock = z.object({ type: z.literal('tool_removal'), tool: toolChangeReference });

const UNTRANSLATED_BLOCK_TYPES = [
	'search_result',
	'server_tool_use',
	'web_search_tool_result',
	'web_fetch_tool_result',
	'advisor_tool_result',
	'code_execution_tool_result',
	'bash_code_execution_tool_result',
	'text_editor_code_execution_tool_result',
	'tool_search_tool_result',
	'mcp_tool_use',
	'mcp_tool_result',
	'container_upload',
	'compaction',
	'mcp_tool_listing',
	'fallback',
] as const;

const untranslatedBlock = z.object({ type: z.enum(UNTRANSLATED_BLOCK_TYPES) });

const contentBlock = z.discriminatedUnion('type', [
	textBlock,
	imageBlock,
	documentBlock,
	thinkingBlock,
	redactedThinkingBlock,
	toolUseBlock,
	toolResultBlock,
	toolAdditionBlock,
	toolRemovalBlock,
	untranslatedBlock,
]);

type ContentBlock = z.infer<typeof contentBlock>;

export type EveryContentBlockIsRead = Exhaustive<
	Exclude<BetaContentBlockParam['type'], ContentBlock['type']>
>;

const messageContent = z.union([z.string(), z.array(contentBlock)]);

const message = z.discriminatedUnion('role', [
	z.object({ role: z.literal('user'), content: messageContent }),
	z.object({ role: z.literal('assistant'), content: messageContent }),
	z.object({ role: z.literal('system'), content: z.union([z.string(), z.array(textBlock)]) }),
]);

const effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);

export const claudeCodeRequest = z.object({
	model: z.string().min(1),
	messages: z.array(message),
	system: z.union([z.string(), z.array(textBlock)]).exactOptional(),
	tools: z.array(z.union([toolDefinition, z.object({ name: z.string() })])).exactOptional(),
	tool_choice: z
		.discriminatedUnion('type', [
			z.object({ type: z.literal('auto') }),
			z.object({ type: z.literal('any') }),
			z.object({ type: z.literal('none') }),
			z.object({ type: z.literal('tool'), name: z.string() }),
		])
		.exactOptional(),
	thinking: z.object({ type: z.string() }).exactOptional(),
	output_config: z
		.object({
			effort: effort.nullable().exactOptional(),
			format: z
				.object({ type: z.literal('json_schema'), schema: z.record(z.string(), z.unknown()) })
				.nullable()
				.exactOptional(),
		})
		.exactOptional(),
	stream: z.boolean().exactOptional(),
});

export type ClaudeCodeRequest = z.infer<typeof claudeCodeRequest>;

type SupportedParameter =
	| 'include'
	| 'model'
	| 'parallel_tool_calls'
	| 'prompt_cache_key'
	| 'reasoning'
	| 'text'
	| 'tool_choice'
	| 'tools';

type ReasoningInput = Omit<ResponseReasoningItem, 'id' | 'status'>;

export type ChatGptInputItem = Exclude<ResponseInputItem, ResponseReasoningItem> | ReasoningInput;

export type ChatGptRequest = Pick<ResponseCreateParamsStreaming, SupportedParameter> & {
	readonly input: ChatGptInputItem[];
	readonly instructions: string;
	readonly store: false;
	readonly stream: true;
};

export interface TranslatedRequest {
	readonly body: ChatGptRequest;
	readonly toolNames: ReadonlyMap<string, string>;
	readonly stream: boolean;
}

export function toChatGptRequest(
	request: ClaudeCodeRequest,
	promptCacheKey: string | null,
): TranslatedRequest {
	const toolNames = new Map<string, string>();
	const nameFor = (original: string): string => {
		const upstream = upstreamToolName(original);
		toolNames.set(upstream, original);
		return upstream;
	};
	const format = request.output_config?.format;
	const tools = activeTools(request).map((tool) => functionTool(tool, nameFor));
	const toolChoice = chatGptToolChoice(request.tool_choice, nameFor);
	return {
		toolNames,
		stream: request.stream ?? false,
		body: {
			model: request.model,
			instructions: instructionsOf(request.system),
			input: inputItems(request.messages, nameFor),
			...(tools.length > 0 ? { tools } : {}),
			...(toolChoice && tools.length > 0 ? { tool_choice: toolChoice } : {}),
			reasoning: { effort: reasoningEffort(request), summary: 'auto' },
			include: ['reasoning.encrypted_content'],
			...(format
				? {
						text: {
							format: { type: 'json_schema', name: 'output', schema: format.schema, strict: false },
						},
					}
				: {}),
			...(promptCacheKey ? { prompt_cache_key: promptCacheKey } : {}),
			store: false,
			stream: true,
		},
	};
}

export function upstreamToolName(name: string): string {
	if (name.length <= MAX_TOOL_NAME_LENGTH && /^[\w-]+$/u.test(name)) return name;
	const digest = createHash('sha256').update(name).digest('hex').slice(0, 8);
	const readable = name.replace(/[^\w-]/gu, '_').slice(0, MAX_TOOL_NAME_LENGTH - digest.length - 1);
	return `${readable}_${digest}`;
}

type ToolDefinition = z.infer<typeof toolDefinition>;

function activeTools(request: ClaudeCodeRequest): ToolDefinition[] {
	const defined = (request.tools ?? []).flatMap((tool) => (isToolDefinition(tool) ? [tool] : []));
	const byName = new Map(defined.map((tool) => [tool.name, tool]));
	const active = new Set(
		defined.filter((tool) => tool.defer_loading !== true).map(({ name }) => name),
	);
	const added = new Map<string, ToolDefinition>();
	for (const { content } of request.messages) {
		if (typeof content === 'string') continue;
		for (const block of content) {
			if (block.type === 'tool_result' && Array.isArray(block.content)) {
				for (const part of block.content) {
					if (part.type === 'tool_reference') active.add(part.tool_name);
				}
			}
			if (block.type === 'tool_addition') {
				for (const tool of addedTools(block.tool, byName)) {
					added.set(tool.name, tool);
					active.add(tool.name);
				}
			}
			if (block.type === 'tool_removal') {
				for (const name of referencedNames(block.tool, byName)) active.delete(name);
			}
		}
	}
	const all = new Map([...byName, ...added]);
	return [...active].flatMap((name) => all.get(name) ?? []);
}

function isToolDefinition(tool: ToolDefinition | { name: string }): tool is ToolDefinition {
	return 'input_schema' in tool;
}

function addedTools(
	tool: z.infer<typeof toolAdditionBlock>['tool'],
	tools: ReadonlyMap<string, ToolDefinition>,
): ToolDefinition[] {
	if (tool.type !== 'tool_definition') {
		return referencedNames(tool, tools).flatMap((name) => tools.get(name) ?? []);
	}
	const parsed = toolDefinition.safeParse(tool.definition);
	return parsed.success ? [parsed.data] : [];
}

function referencedNames(
	reference: z.infer<typeof toolChangeReference>,
	tools: ReadonlyMap<string, ToolDefinition>,
): string[] {
	switch (reference.type) {
		case 'tool_reference':
			return [reference.name];
		case 'mcp_tool_reference':
			return [mcpToolName(reference.server_name, reference.name)];
		case 'mcp_toolset_reference': {
			const prefix = mcpToolName(reference.server_name, '');
			return [...tools.keys()].filter((name) => name.startsWith(prefix));
		}
	}
}

function mcpToolName(server: string, tool: string): string {
	return `mcp__${server}__${tool}`;
}

function functionTool(tool: ToolDefinition, nameFor: (name: string) => string): FunctionTool {
	return {
		type: 'function',
		name: nameFor(tool.name),
		...(tool.description ? { description: tool.description } : {}),
		parameters: tool.input_schema,
		strict: false,
	};
}

function chatGptToolChoice(
	choice: ClaudeCodeRequest['tool_choice'],
	nameFor: (name: string) => string,
): ToolChoiceOptions | ToolChoiceFunction | null {
	switch (choice?.type) {
		case undefined:
			return null;
		case 'auto':
			return 'auto';
		case 'any':
			return 'required';
		case 'none':
			return 'none';
		case 'tool':
			return { type: 'function', name: nameFor(choice.name) };
	}
}

function reasoningEffort(request: ClaudeCodeRequest): z.infer<typeof effort> {
	const requested = request.output_config?.effort;
	if (requested) return requested;
	return request.thinking?.type === 'disabled' ? 'low' : 'medium';
}

function instructionsOf(system: ClaudeCodeRequest['system']): string {
	if (system === undefined) return '';
	if (typeof system === 'string') return system;
	return system
		.map(({ text }) => text)
		.filter((text) => !text.startsWith(BILLING_HEADER_PREFIX))
		.join('\n\n');
}

function inputItems(
	messages: ClaudeCodeRequest['messages'],
	nameFor: (name: string) => string,
): ChatGptInputItem[] {
	return messages.flatMap((entry): ChatGptInputItem[] => {
		switch (entry.role) {
			case 'system':
				return [{ role: 'developer', content: systemText(entry.content) }];
			case 'user':
				return userItems(blocksOf(entry.content));
			case 'assistant':
				return assistantItems(blocksOf(entry.content), nameFor);
		}
	});
}

function systemText(content: string | readonly { text: string }[]): string {
	return typeof content === 'string' ? content : content.map(({ text }) => text).join('\n\n');
}

function blocksOf(content: string | ContentBlock[]): ContentBlock[] {
	return typeof content === 'string' ? [{ type: 'text', text: content }] : content;
}

function userItems(blocks: readonly ContentBlock[]): ChatGptInputItem[] {
	const items: ChatGptInputItem[] = [];
	let parts: ResponseInputContent[] = [];
	const flush = (): void => {
		if (parts.length > 0) items.push({ role: 'user', content: parts } satisfies EasyInputMessage);
		parts = [];
	};
	for (const block of blocks) {
		if (block.type === 'tool_result') {
			flush();
			items.push(functionCallOutput(block));
			continue;
		}
		parts.push(...inputContent(block));
	}
	flush();
	return items;
}

function assistantItems(
	blocks: readonly ContentBlock[],
	nameFor: (name: string) => string,
): ChatGptInputItem[] {
	return blocks.flatMap((block): ChatGptInputItem[] => {
		switch (block.type) {
			case 'text':
				return block.text.length > 0 ? [{ role: 'assistant', content: block.text }] : [];
			case 'thinking':
				return reasoningInput(block);
			case 'tool_use':
				return [
					{
						type: 'function_call',
						call_id: block.id,
						name: nameFor(block.name),
						arguments: JSON.stringify(block.input ?? {}),
					} satisfies ResponseFunctionToolCall,
				];
			default:
				return [];
		}
	});
}

function reasoningInput(block: z.infer<typeof thinkingBlock>): ReasoningInput[] {
	if (!block.signature.startsWith(REASONING_SIGNATURE_PREFIX)) return [];
	return [
		{
			type: 'reasoning',
			summary: block.thinking ? [{ type: 'summary_text', text: block.thinking }] : [],
			encrypted_content: block.signature.slice(REASONING_SIGNATURE_PREFIX.length),
		},
	];
}

function inputContent(block: ContentBlock): ResponseInputContent[] {
	switch (block.type) {
		case 'text':
			return block.text.length > 0 ? [{ type: 'input_text', text: block.text }] : [];
		case 'image':
			return [imageContent(block.source)];
		case 'document':
			return documentContent(block);
		default:
			return [];
	}
}

function imageContent(source: z.infer<typeof imageSource>): ResponseInputContent {
	switch (source.type) {
		case 'base64':
			return {
				type: 'input_image',
				detail: 'auto',
				image_url: `data:${source.media_type};base64,${source.data}`,
			};
		case 'url':
			return { type: 'input_image', detail: 'auto', image_url: source.url };
		case 'file':
			return { type: 'input_text', text: '[An image from the Anthropic Files API was left out]' };
	}
}

function documentContent(block: z.infer<typeof documentBlock>): ResponseInputContent[] {
	const filename = block.title ?? 'document.pdf';
	const { source } = block;
	switch (source.type) {
		case 'base64':
			return [
				{ type: 'input_file', filename, file_data: `data:application/pdf;base64,${source.data}` },
			];
		case 'url':
			return [{ type: 'input_file', filename, file_url: source.url }];
		case 'text':
			return [{ type: 'input_text', text: source.data }];
		case 'content':
			return typeof source.content === 'string'
				? [{ type: 'input_text', text: source.content }]
				: source.content.flatMap(inputContent);
		case 'file':
			return [{ type: 'input_text', text: '[A file from the Anthropic Files API was left out]' }];
	}
}

function functionCallOutput(block: z.infer<typeof toolResultBlock>): ChatGptInputItem {
	const { content } = block;
	if (content === undefined || typeof content === 'string') {
		return { type: 'function_call_output', call_id: block.tool_use_id, output: content ?? '' };
	}
	const output = content.flatMap((part): ResponseFunctionCallOutputItem[] => {
		switch (part.type) {
			case 'text':
				return [{ type: 'input_text', text: part.text }];
			case 'image':
				return [imageContent(part.source)];
			case 'document':
				return documentContent(part);
			case 'tool_reference':
				return [{ type: 'input_text', text: `Tool ${part.tool_name} is now available.` }];
			case 'search_result':
			case 'browser_state':
				return [];
		}
	});
	return { type: 'function_call_output', call_id: block.tool_use_id, output };
}

const reasoningItem = z.object({
	type: z.literal('reasoning'),
	id: z.string(),
	encrypted_content: z.string().nullable().exactOptional(),
	summary: z.array(z.object({ type: z.literal('summary_text'), text: z.string() })),
}) satisfies z.ZodType<
	Pick<ResponseReasoningItem, 'type' | 'id' | 'encrypted_content' | 'summary'>
>;

const functionCallItem = z.object({
	type: z.literal('function_call'),
	call_id: z.string(),
	name: z.string(),
	arguments: z.string(),
}) satisfies z.ZodType<Pick<ResponseFunctionToolCall, 'type' | 'call_id' | 'name' | 'arguments'>>;

const messageItem = z.object({
	type: z.literal('message'),
	content: z.array(
		z.discriminatedUnion('type', [
			z.object({ type: z.literal('output_text'), text: z.string() }),
			z.object({ type: z.literal('refusal'), refusal: z.string() }),
		]),
	),
});

const outputItem = z.union([
	reasoningItem,
	functionCallItem,
	messageItem,
	z.object({ type: z.string() }),
]);

const usage = z.object({
	input_tokens: z.number(),
	output_tokens: z.number(),
	input_tokens_details: z.object({ cached_tokens: z.number() }).nullable().exactOptional(),
}) satisfies z.ZodType<Pick<ResponseUsage, 'input_tokens' | 'output_tokens'>>;

const responseError = z.object({ code: z.string().nullable(), message: z.string() });

const finalResponse = z.object({
	id: z.string(),
	usage: usage.nullable().exactOptional(),
	incomplete_details: z.object({ reason: z.string().exactOptional() }).nullable().exactOptional(),
	error: responseError.nullable().exactOptional(),
});

const TRANSLATED_EVENTS = [
	'response.created',
	'response.output_item.added',
	'response.output_item.done',
	'response.output_text.delta',
	'response.refusal.delta',
	'response.reasoning_summary_part.added',
	'response.reasoning_summary_text.delta',
	'response.function_call_arguments.delta',
	'response.completed',
	'response.incomplete',
	'response.failed',
	'error',
] as const;

const IGNORED_EVENTS = [
	'response.audio.delta',
	'response.audio.done',
	'response.audio.transcript.delta',
	'response.audio.transcript.done',
	'response.code_interpreter_call_code.delta',
	'response.code_interpreter_call_code.done',
	'response.code_interpreter_call.completed',
	'response.code_interpreter_call.in_progress',
	'response.code_interpreter_call.interpreting',
	'response.compaction.compacting',
	'response.content_part.added',
	'response.content_part.done',
	'response.file_search_call.completed',
	'response.file_search_call.in_progress',
	'response.file_search_call.searching',
	'response.function_call_arguments.done',
	'response.shell_call_command.added',
	'response.shell_call_command.delta',
	'response.shell_call_command.done',
	'response.shell_call_output_content.delta',
	'response.shell_call_output_content.done',
	'response.in_progress',
	'response.reasoning_summary_part.done',
	'response.reasoning_summary_text.done',
	'response.reasoning_text.delta',
	'response.reasoning_text.done',
	'response.refusal.done',
	'response.output_text.done',
	'response.web_search_call.completed',
	'response.web_search_call.in_progress',
	'response.web_search_call.searching',
	'response.image_generation_call.completed',
	'response.image_generation_call.generating',
	'response.image_generation_call.in_progress',
	'response.image_generation_call.partial_image',
	'response.mcp_call_arguments.delta',
	'response.mcp_call_arguments.done',
	'response.mcp_call.completed',
	'response.mcp_call.failed',
	'response.mcp_call.in_progress',
	'response.mcp_list_tools.completed',
	'response.mcp_list_tools.failed',
	'response.mcp_list_tools.in_progress',
	'response.output_text.annotation.added',
	'response.queued',
	'response.custom_tool_call_input.delta',
	'response.custom_tool_call_input.done',
] as const;

export type EveryStreamEventIsRead = Exhaustive<
	Exclude<
		ResponseStreamEvent['type'],
		(typeof TRANSLATED_EVENTS)[number] | (typeof IGNORED_EVENTS)[number]
	>
>;

const textDelta = z.object({
	type: z.literal('response.output_text.delta'),
	output_index: z.number(),
	content_index: z.number(),
	delta: z.string(),
}) satisfies z.ZodType<
	Pick<ResponseTextDeltaEvent, 'type' | 'output_index' | 'content_index' | 'delta'>
>;

const refusalDelta = z.object({
	type: z.literal('response.refusal.delta'),
	output_index: z.number(),
	content_index: z.number(),
	delta: z.string(),
}) satisfies z.ZodType<
	Pick<ResponseRefusalDeltaEvent, 'type' | 'output_index' | 'content_index' | 'delta'>
>;

const summaryPartAdded = z.object({
	type: z.literal('response.reasoning_summary_part.added'),
	output_index: z.number(),
	summary_index: z.number(),
}) satisfies z.ZodType<
	Pick<ResponseReasoningSummaryPartAddedEvent, 'type' | 'output_index' | 'summary_index'>
>;

const summaryDelta = z.object({
	type: z.literal('response.reasoning_summary_text.delta'),
	output_index: z.number(),
	delta: z.string(),
}) satisfies z.ZodType<
	Pick<ResponseReasoningSummaryTextDeltaEvent, 'type' | 'output_index' | 'delta'>
>;

const argumentsDelta = z.object({
	type: z.literal('response.function_call_arguments.delta'),
	output_index: z.number(),
	delta: z.string(),
}) satisfies z.ZodType<
	Pick<ResponseFunctionCallArgumentsDeltaEvent, 'type' | 'output_index' | 'delta'>
>;

const upstreamEvent = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('response.created'),
		response: z.object({ id: z.string() }),
	}),
	z.object({
		type: z.literal('response.output_item.added'),
		output_index: z.number(),
		item: outputItem,
	}),
	z.object({
		type: z.literal('response.output_item.done'),
		output_index: z.number(),
		item: outputItem,
	}),
	textDelta,
	refusalDelta,
	summaryPartAdded,
	summaryDelta,
	argumentsDelta,
	z.object({ type: z.literal('response.completed'), response: finalResponse }),
	z.object({ type: z.literal('response.incomplete'), response: finalResponse }),
	z.object({ type: z.literal('response.failed'), response: finalResponse }),
	z.object({
		type: z.literal('error'),
		code: z.string().nullable().exactOptional(),
		message: z.string(),
	}) satisfies z.ZodType<Pick<ResponseErrorEvent, 'type' | 'message'>>,
]);

export type UpstreamEvent = z.infer<typeof upstreamEvent>;

const translatedEvents: ReadonlySet<string> = new Set(TRANSLATED_EVENTS);

export function parseUpstreamEvent(data: string): UpstreamEvent | null {
	const json: unknown = JSON.parse(data);
	const type = z.object({ type: z.string() }).safeParse(json);
	if (!type.success || !translatedEvents.has(type.data.type)) return null;
	return upstreamEvent.parse(json);
}

export type UpstreamErrorKind =
	| 'authentication'
	| 'invalid-request'
	| 'overloaded'
	| 'permission'
	| 'prompt-too-long'
	| 'rate-limit'
	| 'server';

export class UpstreamError extends Error {
	readonly kind: UpstreamErrorKind;
	readonly code: string | null;

	constructor(kind: UpstreamErrorKind, message: string, code: string | null = null) {
		super(message);
		this.name = 'UpstreamError';
		this.kind = kind;
		this.code = code;
	}
}

export function upstreamErrorKind(code: string | null | undefined): UpstreamErrorKind {
	switch (code) {
		case 'context_length_exceeded':
			return 'prompt-too-long';
		case 'rate_limit_exceeded':
		case 'usage_limit_reached':
		case 'insufficient_quota':
		case 'subscription_sharing_usage_limit_exceeded':
		case 'subscription_sharing_workplace_individual_usage_limit_exceeded':
			return 'rate-limit';
		case 'server_is_overloaded':
		case 'slow_down':
		case 'subscription_sharing_usage_unavailable':
		case 'subscription_sharing_user_unavailable':
			return 'overloaded';
		case 'subscription_sharing_user_not_eligible':
		case 'subscription_sharing_route_not_supported':
		case 'chatpass_v2_scope_not_authorized':
		case 'chatpass_v2_invalid_authorization_context':
			return 'permission';
		case 'subscription_sharing_invalid_user':
		case 'invalid_api_key':
		case 'invalid_token':
			return 'authentication';
		case 'server_error':
		case null:
		case undefined:
			return 'server';
		default:
			return 'invalid-request';
	}
}

interface OpenBlock {
	readonly outputIndex: number;
	readonly contentIndex: number;
	readonly kind: 'text' | 'thinking' | 'tool_use';
	readonly index: number;
	streamed: boolean;
}

export class AnthropicStream {
	readonly #model: string;
	readonly #toolNames: ReadonlyMap<string, string>;
	#messageId: string | null = null;
	#nextIndex = 0;
	#open: OpenBlock | null = null;
	#sawToolUse = false;
	#done = false;

	constructor(model: string, toolNames: ReadonlyMap<string, string>) {
		this.#model = model;
		this.#toolNames = toolNames;
	}

	get done(): boolean {
		return this.#done;
	}

	next(event: UpstreamEvent): BetaRawMessageStreamEvent[] {
		switch (event.type) {
			case 'response.created':
				return this.#start(event.response.id);
			case 'response.output_item.added':
				return [...this.#start(null), ...this.#itemAdded(event.output_index, event.item)];
			case 'response.output_item.done':
				return [...this.#start(null), ...this.#itemDone(event.output_index, event.item)];
			case 'response.output_text.delta':
			case 'response.refusal.delta':
				return [
					...this.#start(null),
					...this.#text(event.output_index, event.content_index, event.delta),
				];
			case 'response.reasoning_summary_part.added':
				return event.summary_index > 0 ? this.#thinking(event.output_index, '\n\n') : [];
			case 'response.reasoning_summary_text.delta':
				return this.#thinking(event.output_index, event.delta);
			case 'response.function_call_arguments.delta':
				return this.#arguments(event.output_index, event.delta);
			case 'response.completed':
				return this.#finish(event.response, this.#sawToolUse ? 'tool_use' : 'end_turn');
			case 'response.incomplete':
				return this.#finish(event.response, incompleteStopReason(event.response));
			case 'response.failed':
				throw new UpstreamError(
					upstreamErrorKind(event.response.error?.code),
					event.response.error?.message ?? 'The response failed.',
					event.response.error?.code ?? null,
				);
			case 'error':
				throw new UpstreamError(upstreamErrorKind(event.code), event.message, event.code ?? null);
		}
	}

	#start(responseId: string | null): BetaRawMessageStreamEvent[] {
		if (this.#messageId !== null) return [];
		this.#messageId = responseId ?? 'msg_chatgpt';
		return [{ type: 'message_start', message: emptyMessage(this.#messageId, this.#model) }];
	}

	#itemAdded(outputIndex: number, item: z.infer<typeof outputItem>): BetaRawMessageStreamEvent[] {
		switch (item.type) {
			case 'reasoning':
				return this.#open?.outputIndex === outputIndex
					? []
					: this.#openBlock(outputIndex, 0, 'thinking', {
							type: 'thinking',
							thinking: '',
							signature: '',
						});
			case 'function_call':
				if (!isFunctionCall(item)) return [];
				this.#sawToolUse = true;
				return this.#openBlock(outputIndex, 0, 'tool_use', {
					type: 'tool_use',
					id: item.call_id,
					name: this.#toolNames.get(item.name) ?? item.name,
					input: {},
				});
			default:
				return [];
		}
	}

	#itemDone(outputIndex: number, item: z.infer<typeof outputItem>): BetaRawMessageStreamEvent[] {
		if (isReasoning(item)) {
			const opened =
				this.#open?.outputIndex === outputIndex ? [] : this.#itemAdded(outputIndex, item);
			const summary = this.#open?.streamed ? '' : item.summary.map(({ text }) => text).join('\n\n');
			return [
				...opened,
				...(summary ? this.#thinking(outputIndex, summary) : []),
				...(item.encrypted_content
					? [
							this.#delta({
								type: 'signature_delta',
								signature: reasoningSignature(item.encrypted_content),
							}),
						]
					: []),
				...this.#close(),
			];
		}
		if (isFunctionCall(item)) {
			const opened =
				this.#open?.outputIndex === outputIndex ? [] : this.#itemAdded(outputIndex, item);
			const streamed = this.#open?.streamed ?? false;
			return [
				...opened,
				...(streamed || item.arguments.length === 0
					? []
					: [this.#delta({ type: 'input_json_delta', partial_json: item.arguments })]),
				...this.#close(),
			];
		}
		if (isMessage(item)) {
			const unstreamed =
				this.#open?.outputIndex === outputIndex
					? []
					: item.content.flatMap((part, contentIndex) =>
							this.#text(
								outputIndex,
								contentIndex,
								part.type === 'output_text' ? part.text : part.refusal,
							),
						);
			return [...unstreamed, ...(this.#open?.outputIndex === outputIndex ? this.#close() : [])];
		}
		return [];
	}

	#text(outputIndex: number, contentIndex: number, text: string): BetaRawMessageStreamEvent[] {
		if (text.length === 0) return [];
		const open = this.#open;
		const opened =
			open?.outputIndex === outputIndex &&
			open.contentIndex === contentIndex &&
			open.kind === 'text'
				? []
				: this.#openBlock(outputIndex, contentIndex, 'text', {
						type: 'text',
						text: '',
						citations: null,
					});
		return [...opened, this.#delta({ type: 'text_delta', text })];
	}

	#thinking(outputIndex: number, thinking: string): BetaRawMessageStreamEvent[] {
		if (this.#open?.outputIndex !== outputIndex || this.#open.kind !== 'thinking') return [];
		return [this.#delta({ type: 'thinking_delta', thinking, estimated_tokens: null })];
	}

	#arguments(outputIndex: number, partialJson: string): BetaRawMessageStreamEvent[] {
		if (this.#open?.outputIndex !== outputIndex || this.#open.kind !== 'tool_use') return [];
		return [this.#delta({ type: 'input_json_delta', partial_json: partialJson })];
	}

	#openBlock(
		outputIndex: number,
		contentIndex: number,
		kind: OpenBlock['kind'],
		block: BetaRawContentBlockStartEvent['content_block'],
	): BetaRawMessageStreamEvent[] {
		const closed = this.#close();
		const index = this.#nextIndex;
		this.#nextIndex += 1;
		this.#open = { outputIndex, contentIndex, kind, index, streamed: false };
		return [...closed, { type: 'content_block_start', index, content_block: block }];
	}

	#delta(delta: BetaRawContentBlockDelta): BetaRawMessageStreamEvent {
		const open = this.#open;
		if (!open) throw new UpstreamError('server', 'A delta arrived outside a content block.');
		open.streamed = true;
		return { type: 'content_block_delta', index: open.index, delta };
	}

	#close(): BetaRawMessageStreamEvent[] {
		const open = this.#open;
		if (!open) return [];
		this.#open = null;
		return [{ type: 'content_block_stop', index: open.index }];
	}

	#finish(
		response: z.infer<typeof finalResponse>,
		stopReason: BetaStopReason,
	): BetaRawMessageStreamEvent[] {
		this.#done = true;
		return [
			...this.#start(response.id),
			...this.#close(),
			{
				type: 'message_delta',
				context_management: null,
				delta: {
					container: null,
					stop_details: null,
					stop_reason: stopReason,
					stop_sequence: null,
				},
				usage: deltaUsage(response.usage ?? null),
			},
			{ type: 'message_stop' },
		];
	}
}

function isReasoning(item: z.infer<typeof outputItem>): item is z.infer<typeof reasoningItem> {
	return item.type === 'reasoning' && 'summary' in item;
}

function isFunctionCall(
	item: z.infer<typeof outputItem>,
): item is z.infer<typeof functionCallItem> {
	return item.type === 'function_call' && 'call_id' in item;
}

function isMessage(item: z.infer<typeof outputItem>): item is z.infer<typeof messageItem> {
	return item.type === 'message' && 'content' in item;
}

export function reasoningSignature(encryptedContent: string): string {
	return `${REASONING_SIGNATURE_PREFIX}${encryptedContent}`;
}

function incompleteStopReason(response: z.infer<typeof finalResponse>): BetaStopReason {
	switch (response.incomplete_details?.reason) {
		case 'max_output_tokens':
			return 'max_tokens';
		case 'content_filter':
			return 'refusal';
		default:
			return 'end_turn';
	}
}

function emptyMessage(id: string, model: string): BetaMessage {
	return {
		id,
		type: 'message',
		role: 'assistant',
		model,
		content: [],
		container: null,
		context_management: null,
		diagnostics: null,
		stop_details: null,
		stop_reason: null,
		stop_sequence: null,
		usage: messageUsage(null),
	};
}

function messageUsage(source: z.infer<typeof usage> | null): BetaUsage {
	const cached = source?.input_tokens_details?.cached_tokens ?? 0;
	return {
		cache_creation: null,
		cache_creation_input_tokens: 0,
		cache_read_input_tokens: cached,
		fallback_credit: null,
		inference_geo: null,
		input_tokens: Math.max(0, (source?.input_tokens ?? 0) - cached),
		iterations: null,
		output_tokens: source?.output_tokens ?? 0,
		output_tokens_details: null,
		server_tool_use: null,
		service_tier: null,
		speed: null,
	};
}

function deltaUsage(source: z.infer<typeof usage> | null): BetaMessageDeltaUsage {
	const { cache_creation_input_tokens, cache_read_input_tokens, input_tokens, output_tokens } =
		messageUsage(source);
	return {
		cache_creation_input_tokens,
		cache_read_input_tokens,
		fallback_credit: null,
		input_tokens,
		iterations: null,
		output_tokens,
		output_tokens_details: null,
		server_tool_use: null,
	};
}

export class MessageAccumulator {
	#message: BetaMessage | null = null;
	readonly #partialJson = new Map<number, string>();

	apply(event: BetaRawMessageStreamEvent): void {
		switch (event.type) {
			case 'message_start':
				this.#message = { ...event.message, content: [] };
				return;
			case 'content_block_start':
				this.#current().content[event.index] = { ...event.content_block };
				if (event.content_block.type === 'tool_use') this.#partialJson.set(event.index, '');
				return;
			case 'content_block_delta':
				this.#applyDelta(event.index, event.delta);
				return;
			case 'content_block_stop': {
				const json = this.#partialJson.get(event.index);
				const block = this.#current().content[event.index];
				if (json !== undefined && block?.type === 'tool_use')
					block.input = json ? JSON.parse(json) : {};
				return;
			}
			case 'message_delta': {
				const current = this.#current();
				current.stop_reason = event.delta.stop_reason;
				current.usage = {
					...current.usage,
					input_tokens: event.usage.input_tokens ?? current.usage.input_tokens,
					cache_read_input_tokens: event.usage.cache_read_input_tokens,
					output_tokens: event.usage.output_tokens,
				};
				return;
			}
			case 'message_stop':
				return;
		}
	}

	message(): BetaMessage {
		return this.#current();
	}

	#current(): BetaMessage {
		if (!this.#message) throw new UpstreamError('server', 'The response ended before it started.');
		return this.#message;
	}

	#applyDelta(index: number, delta: BetaRawContentBlockDelta): void {
		const block: BetaContentBlock | undefined = this.#current().content[index];
		if (!block) return;
		if (delta.type === 'text_delta' && block.type === 'text') block.text += delta.text;
		if (delta.type === 'thinking_delta' && block.type === 'thinking')
			block.thinking += delta.thinking;
		if (delta.type === 'signature_delta' && block.type === 'thinking')
			block.signature = delta.signature;
		if (delta.type === 'input_json_delta') {
			this.#partialJson.set(index, (this.#partialJson.get(index) ?? '') + delta.partial_json);
		}
	}
}
