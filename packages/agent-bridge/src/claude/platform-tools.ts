import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { AGENT_REASONING_EFFORTS } from '../agent-profile.js';
import { BRIDGE_MODELS } from '../generated/protocol-contract.js';
import {
	SECRET_NAME,
	type PlatformResult,
	type PlatformTool,
	type PlatformToolCall,
} from '../protocol.js';

type ToolResult = Awaited<ReturnType<SdkMcpToolDefinition['handler']>>;

export type PlatformToolRequester = (call: PlatformToolCall) => Promise<PlatformResult>;

export const PRE_APPROVED_PLATFORM_TOOLS = [
	'jobs_list',
	'events_list',
	'repositories_list',
	'workstreams_list',
	'workstreams_create',
	'workstreams_send',
	'decisions_ask',
	'decisions_answer',
	'plan_write',
	'files_open',
	'secrets_request',
] as const satisfies readonly PlatformTool[];

const SHIP_ONLY_WHEN_ASKED =
	'Open draft and Merge ship work: use them only when the user explicitly asked in this chat to open a pull request or to merge, never on your own.';

const ASKS = 'The user approves it in the chat unless they always allow it.';

const JOB_TRIGGER_GRAMMAR =
	"An event trigger: `on <channel>` for any Malini event from events_list, optionally narrowed with `where <path> is <value>` or `where <path> is set`, several joined with `and`, for example `on pull-requests:ship-changed where merged is set`. Or a schedule on this Mac's clock: `every day`, `every weekday` or `every <day of the week>` `at <HH:MM>`, then `in <owner>` for an organization or `in <owner>/<repository>` for a repository, or nothing for Home, for example `every weekday at 09:00 in bestboyhq/malini`. A scheduled job keeps its own chat at Home or in the organization, or its own workstream in the repository, merges the base branch into that workstream before each run, skips a time while its last run is unfinished, and runs a time it missed while the Mac slept or Malini was closed once when it is back.";

export function platformTools(request: PlatformToolRequester) {
	const call = (tool: PlatformTool, input: Record<string, unknown>): Promise<ToolResult> =>
		platformToolResult(request, { tool, input });
	return [
		tool(
			'jobs_list',
			"List the jobs saved in Malini. A job is an agent task (instructions, a model, effort and skills) or a built-in step such as Open draft or Merge. Returns JSON with each job's id, name, its full instructions (so an edit can keep every line it does not change), runsIn (`workstream`: the workstream it is started from; `new-workstream`: a fresh workstream of the same repository), model, effort, skills, builtin, when (its event trigger or schedule, or null when it runs only when asked), mode (`off`: the trigger never starts it; `ask`: each run waits for the user; `auto`: it runs on its own; null without a trigger), then (the id of the job that runs next after it succeeds, or null), sees (what the user lets it see: `event`, `facts` or `full`; `jobBefore`, the report of the job before it; `chats`, `none`, `starter` or `all`; `attachments`) and internet (whether its commands reach any site, or only Anthropic).",
			{},
			() => call('jobs_list', {}),
		),
		tool(
			'jobs_save',
			`Create a job in Malini, or change one by id. To create, leave out id and pass name and instructions; the other fields have defaults. To change, pass id and only the fields that change. Opening a draft pull request and merging are jobs too, Open draft and Merge: to ship what a job did, set its \`then\` to one of them. ${SHIP_ONLY_WHEN_ASKED} A trigger you add starts Off and never runs until the user turns it on in the Jobs page, so say so. What a job sees and reaches stays with the user, on its page in Jobs: no tool changes it, and a new job sees no chat. The user approves every save in the chat. Returns the saved job as JSON.`,
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
			`Start a job now. A \`workstream\` job runs in this chat's workstream, or in \`workstream\` when you pass one, such as a workstream you started; a \`new-workstream\` job gets a fresh workstream of that workstream's repository. It starts once that workstream's chat is idle, so Merge right after workstreams_create merges what its first turn makes, as the Merge button in its top bar does. The run shows in this chat. Jobs are processes with steps, such as Merge, which waits for checks, fixes them and resolves conflicts before it merges. ${SHIP_ONLY_WHEN_ASKED} In this chat's workstream or one it started, a job runs without asking unless it is Open draft or Merge or its Then leads to one; the user approves those, and every job elsewhere, in the chat unless they always allow it. Returns the queued run as JSON.`,
			{
				job: z.string().min(1).describe('Id or exact name of the job, from jobs_list'),
				context: z
					.string()
					.min(1)
					.optional()
					.describe(
						'Extra context the job gets after its instructions, for example the issue to fix. Only a job whose sees.chats is `starter` or `all` takes it; leave it out for any other job.',
					),
				workstream: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Id or exact name of the workstream to run it in, from workstreams_list or the id workstreams_create returned. Leave out for this chat's workstream.",
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
			'repositories_list',
			"List the repositories in Malini. Returns JSON with each repository's id, name (owner/name), default branch, clone (`cloned`, `cloning` or `not cloned`: whether Malini has it on this machine) and hidden (whether the sidebar hides it).",
			{},
			() => call('repositories_list', {}),
		),
		tool(
			'repositories_clone',
			`Add a repository to Malini and clone it on this machine, or show a hidden one again. Use it instead of git clone or gh repo clone for a repository whose code you will change, then start a workstream in it with workstreams_create. Malini clones in the background: the result's clone is \`cloned\`, or \`cloning\` when it takes longer, and repositories_list shows when it is done. ${ASKS} Returns the repository as JSON.`,
			{
				repository: z
					.string()
					.min(1)
					.describe(
						'owner/name of a GitHub repository, or a git URL (https://, ssh://, file:// or git@) to clone',
					),
			},
			(input) => call('repositories_clone', input),
		),
		tool(
			'repositories_hide',
			`Hide a repository from Malini's sidebar. Its clone and workstreams stay on disk, and repositories_clone shows it again. No tool removes a repository: that stays with the user. ${ASKS}`,
			{
				repository: z
					.string()
					.min(1)
					.describe('Id or owner/name of the repository, from repositories_list'),
			},
			(input) => call('repositories_hide', input),
		),
		tool(
			'workstreams_list',
			"List the workstreams in Malini. Returns JSON with each one's id, name, repository (owner/name), branch, base branch, startedBy (the id of the workstream whose chat started it with workstreams_create, or null), current (whether it is this chat's workstream), working (whether a chat in it is on a turn now), outcome and needs (the `Outcome:` and `Needs:` lines its last finished turn ended with, or null, and always null in a job that does not see every chat), and merged (the pull request it merged, or null), so you see where the work you started stands without reading its code. The ones this chat's workstream started and that were archived since come last, with archived.",
			{
				repository: z
					.string()
					.min(1)
					.optional()
					.describe('Id or owner/name of a repository, to list only its workstreams'),
			},
			(input) => call('workstreams_list', input),
		),
		tool(
			'workstreams_create',
			`Start a workstream of a repository, with a chat in it that the user lands on there: its own git worktree on a fresh branch from the default branch, or from \`base\`: a tag, branch or commit such as a release. Malini clones the repository first when it has not yet, then updates the branch and installs dependencies while the sidebar shows it setting up, and sends \`prompt\` as that chat's first message once it is set up. Malini names the workstream and the chat from that prompt, records that this chat's workstream started it, and tells its chat about the other workstreams this chat started. Use it instead of git worktree, git checkout or a branch of your own to change code in another repository, such as a fork, or apart from this chat's branch. Returns the workstream as JSON with its id, name, repository, branch, base branch, base and chat, the id of that chat. When the user asked for that work shipped, run Open draft or Merge there yourself with jobs_run and this id in \`workstream\`, rather than asking its chat to. A clone that takes longer fails the call: wait for it with repositories_clone, then call this again. It needs no approval: what a chat starts stays in its own tree.`,
			{
				repository: z
					.string()
					.min(1)
					.describe('Id or owner/name of the repository, from repositories_list'),
				prompt: z
					.string()
					.min(1)
					.describe(
						'The first message of the new chat, written as a prompt to the agent there. That agent does not see this chat, so give it the task and everything it needs.',
					),
				base: z
					.string()
					.min(1)
					.optional()
					.describe(
						"A tag, branch or full commit hash on the repository's origin to start from instead of the default branch, for example v0.17.5. Its pull request still targets the default branch.",
					),
			},
			(input) => call('workstreams_create', input),
		),
		tool(
			'workstreams_send',
			"Send a prompt to the chat of a workstream this chat started with workstreams_create, such as the answer to what it needs or a follow-up task. It arrives in that chat as a prompt from this chat, and that chat keeps everything it already knows. Malini delivers it at once when that chat is idle, or as soon as its turn ends, even after a restart, and prompts waiting for the same turn arrive as one. It needs no approval. Returns the workstream, its chat and the delivery as JSON, with the delivery's status: `delivered`, or `waiting` for that chat's turn to end.",
			{
				workstream: z
					.string()
					.min(1)
					.describe(
						'Id or exact name of a workstream this chat started, from workstreams_list or the id workstreams_create returned',
					),
				prompt: z
					.string()
					.min(1)
					.describe(
						'The prompt, written to the agent there. It does not see this chat, so give it everything it needs.',
					),
			},
			(input) => call('workstreams_send', input),
		),
		tool(
			'workstreams_archive',
			`Archive a workstream: Malini saves its uncommitted work and branch, removes its worktree, and lists it under Archived in the sidebar, where the user can restore it. You cannot archive this chat's own workstream, and no tool deletes one. A workstream this chat started, or one those started, archives without asking; the user approves any other in the chat unless they always allow it.`,
			{
				workstream: z
					.string()
					.min(1)
					.describe('Id or exact name of the workstream, from workstreams_list'),
			},
			(input) => call('workstreams_archive', input),
		),
		tool(
			'decisions_ask',
			"Ask the user a decision only they can make, from a chat at Home or in an organization. It shows as a card at the bottom of this chat, one decision at a time, with a picture for each option, and returns at once with the decision's id: keep the work going while the user decides, have the workstreams build the option you recommend meanwhile, and say so in `meanwhile`. The answer reaches you as a prompt when the user picks an option on the card, or inside their message, where you record it with decisions_answer. Ask one decision per call, and only what your plan cannot settle. Set `decided` to record a call you made yourself instead: the user sees it decided and can change it. Returns the decision as JSON.",
			{
				topic: z
					.string()
					.min(1)
					.max(40)
					.describe('A few words naming the decision, for example "Agent hours"'),
				question: z
					.string()
					.min(1)
					.max(200)
					.describe('The question in one sentence, for example "Keep agent hours on your cards?"'),
				why: z
					.string()
					.min(1)
					.max(300)
					.optional()
					.describe('One sentence on why it matters to the user'),
				options: z
					.array(
						z.object({
							label: z.string().min(1).max(60).describe('The option in a few words'),
							note: z
								.string()
								.min(1)
								.max(120)
								.optional()
								.describe('One line on what choosing it means'),
							picture: z
								.string()
								.min(1)
								.optional()
								.describe(
									'Absolute path to a screenshot, a recording (.mp4, .webm) or an HTML page of this option inside the checkout of a workstream this chat started, such as one its report embeds. Leave it out when there is nothing to show.',
								),
						}),
					)
					.min(2)
					.max(4)
					.describe('Two to four options, the one you recommend among them'),
				recommended: z
					.number()
					.int()
					.min(1)
					.max(4)
					.describe('The number of the option you recommend, counting from 1'),
				meanwhile: z
					.string()
					.min(1)
					.max(120)
					.optional()
					.describe(
						'What the workstreams build while the user decides, for example "Building without agent hours meanwhile"',
					),
				decided: z
					.boolean()
					.optional()
					.describe(
						'true to record a decision you already took yourself: Malini shows it decided on your recommendation, and the user can change it',
					),
			},
			(input) => call('decisions_ask', input),
		),
		tool(
			'decisions_answer',
			"Record the user's answer to a decision you asked with decisions_ask, when they answered it in a message rather than on its card. Malini shows it decided in this chat, with their reason. Record each decision their message covers, and leave the rest open. Returns the decision as JSON.",
			{
				decision: z.string().min(1).describe('Id of the decision, from decisions_ask'),
				option: z
					.number()
					.int()
					.min(1)
					.max(4)
					.describe('The number of the option the user chose, counting from 1'),
				reason: z
					.string()
					.min(1)
					.max(300)
					.optional()
					.describe('Their reason, in their words, when they gave one'),
			},
			(input) => call('decisions_answer', input),
		),
		tool(
			'plan_write',
			"Write the plan of a chat at Home or in an organization: what each workstream builds, the contract between them and the decisions so far. Malini keeps it in one file, gives its path to every workstream this chat starts, and shows it in this chat. Each call replaces the whole plan, so pass all of it, and tell the workstreams that build against it with workstreams_send when it changes. Returns the plan's path.",
			{ text: z.string().min(1).describe('The whole plan, in Markdown') },
			(input) => call('plan_write', input),
		),
		tool(
			'files_open',
			"Open a file in a tab beside this chat, where the user reads and edits it. Use it when the user has to write a file you must not read or write yourself, and say in your report what goes in it; a secret never goes in a file, ask for it with secrets_request instead. Malini creates the file empty when it does not exist yet, private to the user when it is outside the worktree. Returns the path it opened and whether it created the file, never the file's contents.",
			{
				path: z
					.string()
					.min(1)
					.describe(
						'The file to open: an absolute path, a path under ~/, or a path relative to the worktree, for example ~/.config/gh/hosts.yml',
					),
				line: z
					.number()
					.int()
					.positive()
					.optional()
					.describe('The line to show and put the cursor on'),
			},
			(input) => call('files_open', input),
		),
		tool(
			'secrets_request',
			'Ask the user for secrets by name, such as an API key a command needs. Malini shows a field for each name on a card in this chat, where the user pastes the value, which Malini keeps for this repository, or for every repository when this chat has none; you never see it. It returns at once: carry on with what does not need them, ask for every name you need in one call, and when nothing else is left, end your turn with the names in `Needs:`. Once the user saves them, Malini tells you in a message, and `$NAME` is set in every command you run from then on, with its value masked as [secret] in every output. Returns the request as JSON.',
			{
				names: z
					.array(z.string().max(100).regex(SECRET_NAME))
					.min(1)
					.max(10)
					.describe(
						'The names your commands read from the environment, for example ["STRIPE_SECRET_KEY"]',
					),
				why: z
					.string()
					.min(1)
					.max(120)
					.describe(
						'The title of the card the user reads: what you need them for, in a few words, for example "To sign and notarize the release build"',
					),
			},
			(input) => call('secrets_request', input),
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
