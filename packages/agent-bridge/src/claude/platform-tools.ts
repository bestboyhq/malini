import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { AGENT_REASONING_EFFORTS } from '../agent-profile.js';
import { BRIDGE_MODELS } from '../generated/protocol-contract.js';
import type { PlatformResult, PlatformTool, PlatformToolCall } from '../protocol.js';

type ToolResult = Awaited<ReturnType<SdkMcpToolDefinition['handler']>>;

export type PlatformToolRequester = (call: PlatformToolCall) => Promise<PlatformResult>;

export const PLATFORM_READ_TOOLS = [
	'jobs_list',
	'routines_list',
	'events_list',
] as const satisfies readonly PlatformTool[];

export const ROUTINE_TRIGGER_GRAMMAR =
	'`when` is a plain-text trigger, one of: `when I run it` (only by hand); `when a new workstream is created`; `when a frontend resource becomes ready`; or `on <channel>` for any Malini event from events_list, optionally narrowed with `where <path> is <value>` or `where <path> is set`, several joined with `and`, for example `on pull-requests:ship-changed where merged is set`.';

export function platformTools(request: PlatformToolRequester) {
	const call = (tool: PlatformTool, input: Record<string, unknown>): Promise<ToolResult> =>
		platformToolResult(request, { tool, input });
	return [
		tool(
			'jobs_list',
			"List the jobs saved in Malini. A job is a reusable agent task: instructions, a model and effort, where it runs (`workstream`: the workstream it is started from; `new-workstream`: a fresh workstream of the same repository) and what it ships (`none`, a `draft` pull request, or `merge`). Returns JSON with each job's id, name, runsIn, output, model, effort, skills, builtin and its full instructions, so an edit can keep every line it does not change.",
			{},
			() => call('jobs_list', {}),
		),
		tool(
			'jobs_save',
			'Create a job in Malini, or change one by id. To create, leave out id and pass name and instructions; the other fields have defaults. To change, pass id and only the fields that change. The user approves every save in the chat. Returns the saved job as JSON.',
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
				output: z
					.enum(['none', 'draft', 'merge'])
					.optional()
					.describe(
						'What the run ships: `none` leaves the changes, `draft` opens a draft pull request, `merge` merges it. Defaults to none.',
					),
				skills: z
					.array(z.string().min(1))
					.max(500)
					.optional()
					.describe(
						'Skills the job\'s agent loads, by name, for example ["adr"]. An empty list loads every skill that is on. Leave out to keep them.',
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
			'routines_list',
			"List the routines saved in Malini. A routine runs jobs in order when its trigger fires. Returns JSON with each routine's id, status (`draft`: never runs on its own; `candidate`: asks the user before each run; `routine`: runs on its own), label, when and steps (the job ids it runs).",
			{},
			() => call('routines_list', {}),
		),
		tool(
			'routines_save',
			`Create a routine, or change one by id. A new routine is saved as a draft that never runs on its own until the user promotes it. To create, leave out id and pass label, when and steps; to change, pass id and only the fields that change. ${ROUTINE_TRIGGER_GRAMMAR} The user approves every save in the chat. Returns the saved routine as JSON.`,
			{
				id: z
					.string()
					.min(1)
					.optional()
					.describe('Id of the routine to change, from routines_list. Leave out to create one.'),
				label: z
					.string()
					.min(1)
					.optional()
					.describe(
						'Short name the user sees, for example "Docs after merge". Required to create.',
					),
				when: z
					.string()
					.min(1)
					.optional()
					.describe(
						'The trigger in plain text, for example `on pull-requests:ship-changed where merged is set`. Required to create.',
					),
				steps: z
					.array(z.string().min(1))
					.min(1)
					.optional()
					.describe(
						'Jobs to run in order, each an id or exact name from jobs_list. Required to create.',
					),
			},
			(input) => call('routines_save', input),
		),
		tool(
			'events_list',
			"List every event Malini emits: its channel, what it means and the TypeScript declaration of its payload. Use a channel in a routine's `on <channel>` trigger, and a payload field path in its `where` clause.",
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
