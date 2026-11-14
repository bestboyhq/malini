import type { ChatTurnFinishedPayload } from '$contract/events';
import type { MaliniDatabase } from '$main/db/driver';
import {
	runOneShotAutomation,
	type SuggestWithAutomation,
} from '$lib/automations/automations.platform';
import {
	getWorkstream,
	isPlaceholderWorkstreamName,
	renameWorkstream,
} from '$shared/repositories/repositories.platform';
import { chatName, isPlaceholderChatName, namerTask } from '../../domain/chat-names';
import { userTurn } from '../runs.repository';
import { namedChatName, nameSession } from '../sessions.repository';

export type ChatRenamed = Readonly<{
	chat: (workstreamId: string, sessionId: string, name: string) => void;
	workstream: (workstreamId: string, name: string) => void;
}>;

type Asked = Readonly<{
	sessionId: string;
	workstreamId: string;
	message: string;
	reply: string | null;
}>;

// ponytail: names from a message alone live in memory, so a restart mid-turn keeps them instead of renaming from the reply; store them on the row if that shows up
export class ChatNamer {
	readonly #db: MaliniDatabase;
	readonly #suggest: SuggestWithAutomation;
	readonly #renamed: ChatRenamed;
	readonly #log: (line: string) => void;
	readonly #fromMessage = new Map<string, Readonly<{ name: string; message: string }>>();
	readonly #workstreamsFromMessage = new Map<
		string,
		Readonly<{ sessionId: string; name: string; message: string }>
	>();
	readonly #naming = new Map<string, Promise<void>>();

	constructor(
		db: MaliniDatabase,
		suggest: SuggestWithAutomation,
		renamed: ChatRenamed,
		log: (line: string) => void,
	) {
		this.#db = db;
		this.#suggest = suggest;
		this.#renamed = renamed;
		this.#log = log;
	}

	promptSent(sessionId: string, workstreamId: string, prompt: string): void {
		this.#after(sessionId, () =>
			this.#name({ sessionId, workstreamId, message: prompt, reply: null }),
		);
	}

	turnFinished({ sessionId, workstreamId, runId }: ChatTurnFinishedPayload): void {
		this.#after(sessionId, async () => {
			const turn = userTurn(this.#db, runId);
			if (turn !== null) {
				await this.#name({
					sessionId,
					workstreamId,
					message: turn.prompt,
					reply: turn.summary ?? '',
				});
			}
		});
	}

	async nameWorkstream(workstreamId: string, prompt: string): Promise<void> {
		const before = getWorkstream(this.#db, workstreamId)?.name ?? '';
		if (!isPlaceholderWorkstreamName(before)) return;
		const name = await this.#suggestion(namerTask(prompt, null));
		if (name !== null) this.#renameWorkstream(workstreamId, before, name);
	}

	async settled(): Promise<void> {
		while (this.#naming.size > 0) await Promise.all(this.#naming.values());
	}

	#after(sessionId: string, naming: () => Promise<void>): void {
		const next = this.#queued(sessionId, this.#naming.get(sessionId), naming);
		this.#naming.set(sessionId, next);
		void this.#forget(sessionId, next);
	}

	async #queued(
		sessionId: string,
		previous: Promise<void> | undefined,
		naming: () => Promise<void>,
	): Promise<void> {
		await previous;
		try {
			await naming();
		} catch (error) {
			this.#log(`agent: could not name chat \`${sessionId}\`: ${describe(error)}`);
		}
	}

	async #forget(sessionId: string, job: Promise<void>): Promise<void> {
		await job;
		if (this.#naming.get(sessionId) === job) this.#naming.delete(sessionId);
	}

	async #name({ sessionId, workstreamId, message, reply }: Asked): Promise<void> {
		const chat = namedChatName(this.#db, sessionId);
		if (chat === null) return;
		const workstream = getWorkstream(this.#db, workstreamId)?.name ?? '';
		const refines = reply !== null && reply.trim() !== '';
		const chatFromMessage = this.#fromMessage.get(sessionId);
		const workstreamFromMessage = this.#workstreamsFromMessage.get(workstreamId);
		const fromMessage =
			workstreamFromMessage?.sessionId === sessionId ? workstreamFromMessage : undefined;
		const namesChat = isPlaceholderChatName(chat) || (refines && chatFromMessage?.name === chat);
		const namesWorkstream =
			isPlaceholderWorkstreamName(workstream) || (refines && fromMessage?.name === workstream);
		if (reply !== null) {
			this.#fromMessage.delete(sessionId);
			if (fromMessage) this.#workstreamsFromMessage.delete(workstreamId);
		}
		if (!namesChat && !namesWorkstream) return;
		const asked = refines ? (chatFromMessage ?? fromMessage)?.message : undefined;
		const name = await this.#suggestion(namerTask(asked ?? message, reply));
		if (name === null) return;
		if (namesChat && namedChatName(this.#db, sessionId) === chat) {
			const named = nameSession(this.#db, sessionId, workstreamId, name);
			if (reply === null) this.#fromMessage.set(sessionId, { name: named, message });
			if (named !== chat) this.#renamed.chat(workstreamId, sessionId, named);
		}
		if (!namesWorkstream) return;
		const named = this.#renameWorkstream(workstreamId, workstream, name);
		if (reply === null && named !== null) {
			this.#workstreamsFromMessage.set(workstreamId, { sessionId, name: named, message });
		}
	}

	#renameWorkstream(workstreamId: string, before: string, name: string): string | null {
		if ((getWorkstream(this.#db, workstreamId)?.name ?? '') !== before) return null;
		const named = renameWorkstream(this.#db, workstreamId, name);
		if (named !== null && named !== before) this.#renamed.workstream(workstreamId, named);
		return named;
	}

	async #suggestion(task: string | null): Promise<string | null> {
		if (task === null) return null;
		try {
			return chatName(await runOneShotAutomation(this.#db, 'name-chats', task, this.#suggest));
		} catch (error) {
			this.#log(`agent: Claude did not name the chat, so it keeps its name: ${describe(error)}`);
			return null;
		}
	}
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
