import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { describe, expect, it } from 'vitest';
import {
	AnthropicStream,
	claudeCodeRequest,
	MessageAccumulator,
	parseUpstreamEvent,
	reasoningSignature,
	toChatGptRequest,
	UpstreamError,
	upstreamErrorKind,
	upstreamToolName,
} from './translate';

const DOCS_TOOL = 'mcp__claude.ai Docs__read';
const LONG_TOOL = `mcp__workspace__${'search_every_file_in_the_repository_'.repeat(2)}fast`;

function schema(property: string): Record<string, unknown> {
	return {
		type: 'object',
		properties: { [property]: { type: 'string' } },
		required: [property],
	};
}

function translated(
	events: readonly Record<string, unknown>[],
	toolNames: ReadonlyMap<string, string> = new Map(),
): { events: BetaRawMessageStreamEvent[]; done: boolean } {
	const stream = new AnthropicStream('gpt-6.1-sol', toolNames);
	const out = events.flatMap((event) => {
		const parsed = parseUpstreamEvent(JSON.stringify(event));
		return parsed ? stream.next(parsed) : [];
	});
	return { events: out, done: stream.done };
}

function accumulated(events: readonly BetaRawMessageStreamEvent[]) {
	const accumulator = new MessageAccumulator();
	for (const event of events) accumulator.apply(event);
	return accumulator.message();
}

describe('toChatGptRequest', () => {
	it('turns a Claude Code turn into a stateless Responses request', () => {
		const request = claudeCodeRequest.parse({
			model: 'gpt-6.1-sol',
			max_tokens: 32_000,
			stream: true,
			metadata: { user_id: 'user_abc_account_def_session_ghi' },
			thinking: { type: 'adaptive' },
			output_config: { effort: 'high' },
			system: [
				{
					type: 'text',
					text: 'x-anthropic-billing-header: cc_version=2.1.0.abc; cc_entrypoint=sdk-ts;',
				},
				{ type: 'text', text: 'You are Claude Code.', cache_control: { type: 'ephemeral' } },
				{ type: 'text', text: 'Be brief.' },
			],
			tools: [
				{ name: 'Read', description: 'Read a file', input_schema: schema('file_path') },
				{ name: 'ToolSearch', description: 'Load deferred tools', input_schema: schema('query') },
				{
					name: 'WebFetch',
					description: 'Fetch a URL',
					input_schema: schema('url'),
					defer_loading: true,
				},
				{
					name: 'NotebookEdit',
					description: 'Edit a notebook',
					input_schema: schema('notebook_path'),
					defer_loading: true,
				},
				{ name: DOCS_TOOL, input_schema: schema('id') },
				{ name: LONG_TOOL, input_schema: schema('pattern') },
				{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 },
			],
			tool_choice: { type: 'any' },
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: 'What is in this screenshot and the spec?' },
						{
							type: 'image',
							source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' },
						},
						{
							type: 'document',
							title: 'spec.pdf',
							source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjc=' },
						},
					],
				},
				{
					role: 'assistant',
					content: [
						{
							type: 'thinking',
							thinking: 'The user wants a summary.',
							signature: reasoningSignature('gAAAAB-earlier'),
						},
						{ type: 'thinking', thinking: 'Claude reasoning', signature: 'EqQBCkYIBxgCKkB' },
						{ type: 'text', text: 'Reading the file.' },
						{ type: 'tool_use', id: 'toolu_01', name: 'Read', input: { file_path: '/repo/a.ts' } },
						{
							type: 'tool_use',
							id: 'toolu_02',
							name: 'ToolSearch',
							input: { query: 'select:WebFetch' },
						},
					],
				},
				{
					role: 'user',
					content: [
						{
							type: 'tool_result',
							tool_use_id: 'toolu_01',
							content: [
								{ type: 'text', text: 'export const a = 1;' },
								{
									type: 'image',
									source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQ' },
								},
							],
						},
						{
							type: 'tool_result',
							tool_use_id: 'toolu_02',
							content: [{ type: 'tool_reference', tool_name: 'WebFetch' }],
						},
						{ type: 'text', text: 'Now fetch the docs.', cache_control: { type: 'ephemeral' } },
					],
				},
			],
		});

		const { body, stream, toolNames } = toChatGptRequest(request, 'session-1');

		expect(stream).toBe(true);
		expect(body).toEqual({
			model: 'gpt-6.1-sol',
			instructions: 'You are Claude Code.\n\nBe brief.',
			input: [
				{
					role: 'user',
					content: [
						{ type: 'input_text', text: 'What is in this screenshot and the spec?' },
						{
							type: 'input_image',
							detail: 'auto',
							image_url: 'data:image/png;base64,iVBORw0KGgo=',
						},
						{
							type: 'input_file',
							filename: 'spec.pdf',
							file_data: 'data:application/pdf;base64,JVBERi0xLjc=',
						},
					],
				},
				{
					type: 'reasoning',
					summary: [{ type: 'summary_text', text: 'The user wants a summary.' }],
					encrypted_content: 'gAAAAB-earlier',
				},
				{ role: 'assistant', content: 'Reading the file.' },
				{
					type: 'function_call',
					call_id: 'toolu_01',
					name: 'Read',
					arguments: '{"file_path":"/repo/a.ts"}',
				},
				{
					type: 'function_call',
					call_id: 'toolu_02',
					name: 'ToolSearch',
					arguments: '{"query":"select:WebFetch"}',
				},
				{
					type: 'function_call_output',
					call_id: 'toolu_01',
					output: [
						{ type: 'input_text', text: 'export const a = 1;' },
						{ type: 'input_image', detail: 'auto', image_url: 'data:image/jpeg;base64,/9j/4AAQ' },
					],
				},
				{
					type: 'function_call_output',
					call_id: 'toolu_02',
					output: [{ type: 'input_text', text: 'Tool WebFetch is now available.' }],
				},
				{ role: 'user', content: [{ type: 'input_text', text: 'Now fetch the docs.' }] },
			],
			tools: [
				{
					type: 'function',
					name: 'Read',
					description: 'Read a file',
					parameters: schema('file_path'),
					strict: false,
				},
				{
					type: 'function',
					name: 'ToolSearch',
					description: 'Load deferred tools',
					parameters: schema('query'),
					strict: false,
				},
				{
					type: 'function',
					name: upstreamToolName(DOCS_TOOL),
					parameters: schema('id'),
					strict: false,
				},
				{
					type: 'function',
					name: upstreamToolName(LONG_TOOL),
					parameters: schema('pattern'),
					strict: false,
				},
				{
					type: 'function',
					name: 'WebFetch',
					description: 'Fetch a URL',
					parameters: schema('url'),
					strict: false,
				},
			],
			tool_choice: 'required',
			reasoning: { effort: 'high', summary: 'auto' },
			include: ['reasoning.encrypted_content'],
			prompt_cache_key: 'session-1',
			store: false,
			stream: true,
		});
		expect(Object.fromEntries(toolNames)).toEqual({
			Read: 'Read',
			ToolSearch: 'ToolSearch',
			WebFetch: 'WebFetch',
			[upstreamToolName(DOCS_TOOL)]: DOCS_TOOL,
			[upstreamToolName(LONG_TOOL)]: LONG_TOOL,
		});
	});

	it('names every tool the way the Responses API accepts', () => {
		expect(upstreamToolName('Read')).toBe('Read');
		expect(upstreamToolName(DOCS_TOOL)).toMatch(/^mcp__claude_ai_Docs__read_[0-9a-f]{8}$/u);
		expect(upstreamToolName(LONG_TOOL)).toMatch(/^[\w-]{64}$/u);
		expect(upstreamToolName(`${LONG_TOOL}er`)).not.toBe(upstreamToolName(LONG_TOOL));
	});

	it('picks the effort Claude Code asks for, else medium, else low without thinking', () => {
		const minimal = (fields: Record<string, unknown>) =>
			toChatGptRequest(
				claudeCodeRequest.parse({
					model: 'gpt-5.5',
					messages: [{ role: 'user', content: 'hi' }],
					...fields,
				}),
				null,
			);

		expect(minimal({})).toEqual({
			toolNames: new Map(),
			stream: false,
			body: {
				model: 'gpt-5.5',
				instructions: '',
				input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
				reasoning: { effort: 'medium', summary: 'auto' },
				include: ['reasoning.encrypted_content'],
				store: false,
				stream: true,
			},
		});
		expect(minimal({ thinking: { type: 'disabled' } }).body.reasoning).toEqual({
			effort: 'low',
			summary: 'auto',
		});
		expect(
			minimal({ thinking: { type: 'disabled' }, output_config: { effort: 'max' } }).body.reasoning,
		).toEqual({ effort: 'max', summary: 'auto' });
	});
});

describe('AnthropicStream', () => {
	it('streams reasoning, text and a tool call as Anthropic events', () => {
		const call = upstreamToolName(LONG_TOOL);
		const { events, done } = translated(
			[
				{
					type: 'response.created',
					sequence_number: 0,
					response: {
						id: 'resp_01',
						object: 'response',
						status: 'in_progress',
						model: 'gpt-6.1-sol',
						output: [],
						usage: null,
					},
				},
				{
					type: 'response.in_progress',
					sequence_number: 1,
					response: { id: 'resp_01', object: 'response', status: 'in_progress' },
				},
				{
					type: 'response.output_item.added',
					sequence_number: 2,
					output_index: 0,
					item: { id: 'rs_01', type: 'reasoning', summary: [] },
				},
				{
					type: 'response.reasoning_summary_part.added',
					sequence_number: 3,
					item_id: 'rs_01',
					output_index: 0,
					summary_index: 0,
					part: { type: 'summary_text', text: '' },
				},
				{
					type: 'response.reasoning_summary_text.delta',
					sequence_number: 4,
					item_id: 'rs_01',
					output_index: 0,
					summary_index: 0,
					delta: 'Checking the ',
				},
				{
					type: 'response.reasoning_summary_text.delta',
					sequence_number: 5,
					item_id: 'rs_01',
					output_index: 0,
					summary_index: 0,
					delta: 'repository.',
				},
				{
					type: 'response.reasoning_summary_text.done',
					sequence_number: 6,
					item_id: 'rs_01',
					output_index: 0,
					summary_index: 0,
					text: 'Checking the repository.',
				},
				{
					type: 'response.reasoning_summary_part.added',
					sequence_number: 7,
					item_id: 'rs_01',
					output_index: 0,
					summary_index: 1,
					part: { type: 'summary_text', text: '' },
				},
				{
					type: 'response.reasoning_summary_text.delta',
					sequence_number: 8,
					item_id: 'rs_01',
					output_index: 0,
					summary_index: 1,
					delta: 'Search next.',
				},
				{
					type: 'response.output_item.done',
					sequence_number: 9,
					output_index: 0,
					item: {
						id: 'rs_01',
						type: 'reasoning',
						summary: [
							{ type: 'summary_text', text: 'Checking the repository.' },
							{ type: 'summary_text', text: 'Search next.' },
						],
						encrypted_content: 'gAAAAB-encrypted',
					},
				},
				{
					type: 'response.output_item.added',
					sequence_number: 10,
					output_index: 1,
					item: {
						id: 'msg_01',
						type: 'message',
						status: 'in_progress',
						role: 'assistant',
						content: [],
					},
				},
				{
					type: 'response.content_part.added',
					sequence_number: 11,
					item_id: 'msg_01',
					output_index: 1,
					content_index: 0,
					part: { type: 'output_text', text: '', annotations: [] },
				},
				{
					type: 'response.output_text.delta',
					sequence_number: 12,
					item_id: 'msg_01',
					output_index: 1,
					content_index: 0,
					delta: 'Let me ',
					logprobs: [],
				},
				{
					type: 'response.output_text.delta',
					sequence_number: 13,
					item_id: 'msg_01',
					output_index: 1,
					content_index: 0,
					delta: 'search.',
					logprobs: [],
				},
				{
					type: 'response.output_text.done',
					sequence_number: 14,
					item_id: 'msg_01',
					output_index: 1,
					content_index: 0,
					text: 'Let me search.',
				},
				{
					type: 'response.output_item.done',
					sequence_number: 15,
					output_index: 1,
					item: {
						id: 'msg_01',
						type: 'message',
						status: 'completed',
						role: 'assistant',
						content: [{ type: 'output_text', text: 'Let me search.', annotations: [] }],
					},
				},
				{
					type: 'response.output_item.added',
					sequence_number: 16,
					output_index: 2,
					item: {
						id: 'fc_01',
						type: 'function_call',
						status: 'in_progress',
						call_id: 'call_01',
						name: call,
						arguments: '',
					},
				},
				{
					type: 'response.function_call_arguments.delta',
					sequence_number: 17,
					item_id: 'fc_01',
					output_index: 2,
					delta: '{"pattern":',
				},
				{
					type: 'response.function_call_arguments.delta',
					sequence_number: 18,
					item_id: 'fc_01',
					output_index: 2,
					delta: '"TODO"}',
				},
				{
					type: 'response.function_call_arguments.done',
					sequence_number: 19,
					item_id: 'fc_01',
					output_index: 2,
					arguments: '{"pattern":"TODO"}',
				},
				{
					type: 'response.output_item.done',
					sequence_number: 20,
					output_index: 2,
					item: {
						id: 'fc_01',
						type: 'function_call',
						status: 'completed',
						call_id: 'call_01',
						name: call,
						arguments: '{"pattern":"TODO"}',
					},
				},
				{
					type: 'response.completed',
					sequence_number: 21,
					response: {
						id: 'resp_01',
						object: 'response',
						status: 'completed',
						model: 'gpt-6.1-sol',
						incomplete_details: null,
						error: null,
						usage: {
							input_tokens: 1200,
							input_tokens_details: { cached_tokens: 1000 },
							output_tokens: 80,
							output_tokens_details: { reasoning_tokens: 40 },
							total_tokens: 1280,
						},
					},
				},
			],
			new Map([[call, LONG_TOOL]]),
		);

		expect(done).toBe(true);
		expect(events).toEqual([
			{
				type: 'message_start',
				message: {
					id: 'resp_01',
					type: 'message',
					role: 'assistant',
					model: 'gpt-6.1-sol',
					content: [],
					container: null,
					context_management: null,
					diagnostics: null,
					stop_details: null,
					stop_reason: null,
					stop_sequence: null,
					usage: {
						cache_creation: null,
						cache_creation_input_tokens: 0,
						cache_read_input_tokens: 0,
						fallback_credit: null,
						inference_geo: null,
						input_tokens: 0,
						iterations: null,
						output_tokens: 0,
						output_tokens_details: null,
						server_tool_use: null,
						service_tier: null,
						speed: null,
					},
				},
			},
			{
				type: 'content_block_start',
				index: 0,
				content_block: { type: 'thinking', thinking: '', signature: '' },
			},
			{
				type: 'content_block_delta',
				index: 0,
				delta: { type: 'thinking_delta', thinking: 'Checking the ', estimated_tokens: null },
			},
			{
				type: 'content_block_delta',
				index: 0,
				delta: { type: 'thinking_delta', thinking: 'repository.', estimated_tokens: null },
			},
			{
				type: 'content_block_delta',
				index: 0,
				delta: { type: 'thinking_delta', thinking: '\n\n', estimated_tokens: null },
			},
			{
				type: 'content_block_delta',
				index: 0,
				delta: { type: 'thinking_delta', thinking: 'Search next.', estimated_tokens: null },
			},
			{
				type: 'content_block_delta',
				index: 0,
				delta: { type: 'signature_delta', signature: reasoningSignature('gAAAAB-encrypted') },
			},
			{ type: 'content_block_stop', index: 0 },
			{
				type: 'content_block_start',
				index: 1,
				content_block: { type: 'text', text: '', citations: null },
			},
			{ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Let me ' } },
			{ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'search.' } },
			{ type: 'content_block_stop', index: 1 },
			{
				type: 'content_block_start',
				index: 2,
				content_block: { type: 'tool_use', id: 'call_01', name: LONG_TOOL, input: {} },
			},
			{
				type: 'content_block_delta',
				index: 2,
				delta: { type: 'input_json_delta', partial_json: '{"pattern":' },
			},
			{
				type: 'content_block_delta',
				index: 2,
				delta: { type: 'input_json_delta', partial_json: '"TODO"}' },
			},
			{ type: 'content_block_stop', index: 2 },
			{
				type: 'message_delta',
				context_management: null,
				delta: {
					container: null,
					stop_details: null,
					stop_reason: 'tool_use',
					stop_sequence: null,
				},
				usage: {
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 1000,
					fallback_credit: null,
					input_tokens: 200,
					iterations: null,
					output_tokens: 80,
					output_tokens_details: null,
					server_tool_use: null,
				},
			},
			{ type: 'message_stop' },
		]);
		expect(accumulated(events)).toMatchObject({
			id: 'resp_01',
			content: [
				{
					type: 'thinking',
					thinking: 'Checking the repository.\n\nSearch next.',
					signature: reasoningSignature('gAAAAB-encrypted'),
				},
				{ type: 'text', text: 'Let me search.', citations: null },
				{ type: 'tool_use', id: 'call_01', name: LONG_TOOL, input: { pattern: 'TODO' } },
			],
			stop_reason: 'tool_use',
			usage: { input_tokens: 200, cache_read_input_tokens: 1000, output_tokens: 80 },
		});
	});

	it('stops at max_tokens when the response runs out of output tokens', () => {
		const { events, done } = translated([
			{ type: 'response.created', response: { id: 'resp_02', status: 'in_progress' } },
			{
				type: 'response.output_item.added',
				output_index: 0,
				item: {
					id: 'msg_02',
					type: 'message',
					status: 'in_progress',
					role: 'assistant',
					content: [],
				},
			},
			{
				type: 'response.output_text.delta',
				item_id: 'msg_02',
				output_index: 0,
				content_index: 0,
				delta: 'The answer is',
				logprobs: [],
			},
			{
				type: 'response.incomplete',
				response: {
					id: 'resp_02',
					status: 'incomplete',
					incomplete_details: { reason: 'max_output_tokens' },
					usage: {
						input_tokens: 10,
						input_tokens_details: { cached_tokens: 0 },
						output_tokens: 4096,
					},
				},
			},
		]);

		expect(done).toBe(true);
		expect(accumulated(events)).toMatchObject({
			content: [{ type: 'text', text: 'The answer is' }],
			stop_reason: 'max_tokens',
			usage: { input_tokens: 10, output_tokens: 4096 },
		});
	});

	it('fails with the plan error ChatGPT reports mid-stream', () => {
		const stream = new AnthropicStream('gpt-6.1-sol', new Map());
		const next = (event: Record<string, unknown>) => {
			const parsed = parseUpstreamEvent(JSON.stringify(event));
			return parsed ? stream.next(parsed) : [];
		};
		next({ type: 'response.created', response: { id: 'resp_03', status: 'in_progress' } });

		let failure: unknown = null;
		try {
			next({
				type: 'response.failed',
				response: {
					id: 'resp_03',
					status: 'failed',
					error: {
						code: 'subscription_sharing_usage_limit_exceeded',
						message: 'You have reached your usage limit.',
					},
				},
			});
		} catch (error) {
			failure = error;
		}

		expect(failure).toBeInstanceOf(UpstreamError);
		expect(failure).toMatchObject({
			kind: 'rate-limit',
			code: 'subscription_sharing_usage_limit_exceeded',
			message: 'You have reached your usage limit.',
		});
		expect(
			[
				'subscription_sharing_usage_unavailable',
				'subscription_sharing_unsupported_capability',
				'subscription_sharing_user_not_eligible',
				'subscription_sharing_invalid_user',
			].map((code) => upstreamErrorKind(code)),
		).toEqual(['overloaded', 'invalid-request', 'permission', 'authentication']);
	});
});
