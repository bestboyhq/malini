import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { AGENT_REASONING_EFFORTS } from '../agent-profile.js';
import { BRIDGE_MODELS } from '../generated/protocol-contract.js';
import type { PlatformResult, PlatformTool, PlatformToolCall } from '../protocol.js';

type ToolResult = Awaited<ReturnType<SdkMcpToolDefinition['handler']>>;

export type PlatformToolRequester = (call: PlatformToolCall) => Promise<PlatformResult>;

export const PLATFORM_READ_TOOLS = [
	'jobs_list',
	'events_list',
] as const satisfies readonly PlatformTool[];

const JOB_TRIGGER_GRAMMAR =
	'An event trigger: `on <channel>` for any Malini event from events_list, optionally narrowed with `where <path> is <value>` or `where <path> is set`, several joined with `and`, for example `on pull-requests:ship-changed where merged is set`.';

export function platformTools(request: PlatformToolRequester) {
	const call = (tool: PlatformTool, input: Record<string, unknown>): Promise<ToolResult> =>
		platformToolResult(request, { tool, input });
	return [
		tool(
			'jobs_list',
			"List the jobs saved in Malini. A job is an agent task (instructions, a model, effort and skills) or a built-in step such as Open draft or Merge. Returns JSON with each job's id, name, its full instructions (so an edit can keep every line it does not change), runsIn (`workstream`: the workstream it is started from; `new-workstream`: a fresh workstream of the same repository), model, effort, skills, builtin, when (its event trigger, or null when it runs only when asked), mode (`off`: the trigger never starts it; `ask`: each run waits for the user; `auto`: it runs on its own; null without a trigger) and then (the id of the job that runs next after it succeeds, or null).",
			{},
			() => call('jobs_list', {}),
		),
		tool(
			'jobs_save',
			'Create a job in Malini, or change one by id. To create, leave out id and pass name and instructions; the other fields have defaults. To change, pass id and only the fields that change. Opening a draft pull request and merging are jobs too, Open draft and Merge: to ship what a job did, set its `then` to one of them. A trigger you add starts Off and never runs until the user turns it on in the Jobs page, so say so. The user approves every save in the chat. Returns the saved job as JSON.',
			{
				id: z
					.string()
					.min(1)
					.optional()
					.describe('Id of the job to change, from jobs_list. Leave out to create a job.'),
				name: z
					.string()
					.min(1)
					.optional()
					.describe('Short name the user sees, for example "Update the docs". Required to create.'),
				instructions: z
					.string()
					.min(1)
					.optional()
					.describe(
						'What the agent does when the job runs, written as a prompt to that agent. Required to create.',
					),
				model: z
					.enum(BRIDGE_MODELS)
					.optional()
					.describe('Model that runs the job. Defaults to opus.'),
				effort: z
					.enum(AGENT_REASONING_EFFORTS)
					.optional()
					.describe('Reasoning effort of the run. Defaults to high.'),
				runsIn: z
					.enum(['workstream', 'new-workstream'])
					.optional()
					.describe(
						'`workstream` runs in the workstream it is started from; `new-workstream` creates a fresh workstream of the same repository. Defaults to workstream.',
					),
				skills: z
					.array(z.string().min(1))
					.max(500)
					.optional()
					.describe(
						'Skills the job\'s agent loads, by name, for example ["adr"]. An empty list loads every skill that is on. Leave out to keep them.',
					),
				when: z
					.string()
					.min(1)
					.nullable()
					.optional()
					.describe(
						`When the job starts on its own. ${JOB_TRIGGER_GRAMMAR} null for a job that runs only when asked. Leave out to keep it.`,
					),
				then: z
					.string()
					.min(1)
					.nullable()
					.optional()
					.describe(
						'The job that runs next, in the same workstream, once this one succeeds, with its result as context: an id or exact name from jobs_list, for example "Open draft" or "Merge". null for none. Leave out to keep it.',
					),
			},
			(input) => call('jobs_save', input),
		),
		tool(
			'jobs_run',
			"Start a job now. A `workstream` job runs in this chat's workstream; a `new-workstream` job gets a fresh workstream of this repository. The run shows in this chat. The user approves every run. Returns the queued run as JSON.",
			{
				job: z.string().min(1).describe('Id or exact name of the job, from jobs_list'),
				context: z
					.string()
					.min(1)
					.optional()
					.describe(
						'Extra context the job gets after its instructions, for example the issue to fix',
					),
			},
			(input) => call('jobs_run', input),
		),
		tool(
			'events_list',
			"List every event Malini emits: its channel, what it means and the TypeScript declaration of its payload. Use a channel in a job's `when` trigger, `on <channel>`, and a payload field path in its `where` clause.",
			{},
			() => call('events_list', {}),
		),
		tool(
			'pull_requests_open_draft',
			"Open a draft pull request of this workstream's changes once your turn ends. Malini commits with your `Commit:` line, pushes the branch and opens the draft under your `Pull request:` title, so leave your changes in the working tree and write both footer lines. When a pull request is already open, Malini pushes this turn's changes to it instead. Returns right away; a failure shows in Malini's top bar. The user approves it in the chat unless they always allow it.",
			{},
			() => call('pull_requests_open_draft', {}),
		),
	];
}

async function platformToolResult(
	request: PlatformToolRequester,
	call: PlatformToolCall,
): Promise<ToolResult> {
	try {
		const result = await request(call);
		if (result.ok) return { content: [{ type: 'text', text: result.text ?? 'Done.' }] };
		return failure(result.error ?? 'Malini could not do that.');
	} catch (error) {
		return failure(error instanceof Error ? error.message : String(error));
	}
}

function failure(text: string): ToolResult {
	return { content: [{ type: 'text', text }], isError: true };
}
