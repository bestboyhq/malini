import { EventEmitter } from 'node:events';
import type { AgentEvent, SessionStatus } from './types.js';

export interface SessionRecord {
	sessionId: string;
	model?: string;
	providerSessionId?: string;
	status: SessionStatus;
	workstreamId: string;
	createdAt: number;
}

export interface SessionStatusChange {
	sessionId: string;
	status: SessionStatus;
}

export type SessionLifecycleEvent =
	| { kind: 'session.opened'; sessionId: string }
	| { kind: 'session.closed'; sessionId: string }
	| { kind: 'session.status'; change: SessionStatusChange };

export class SessionAlreadyOpenError extends Error {
	constructor(public readonly sessionId: string) {
		super(`ALREADY_OPEN: session ${sessionId} is already registered`);
		this.name = 'SessionAlreadyOpenError';
	}
}

export class UnknownSessionError extends Error {
	constructor(public readonly sessionId: string) {
		super(`UNKNOWN_SESSION: ${sessionId}`);
		this.name = 'UnknownSessionError';
	}
}

export class SessionManager {
	private readonly records = new Map<string, SessionRecord>();
	private readonly emitter = new EventEmitter();

	constructor(private readonly now: () => number = Date.now) {}

	register(input: {
		sessionId: string;
		workstreamId: string;
		model?: string;
		providerSessionId?: string;
	}): SessionRecord {
		if (this.records.has(input.sessionId)) {
			throw new SessionAlreadyOpenError(input.sessionId);
		}
		const record: SessionRecord = {
			sessionId: input.sessionId,
			workstreamId: input.workstreamId,
			status: 'idle',
			createdAt: Date.now(),
			...(input.model !== undefined ? { model: input.model } : {}),
			...(input.providerSessionId !== undefined
				? { providerSessionId: input.providerSessionId }
				: {}),
		};
		this.records.set(record.sessionId, record);
		const evt: SessionLifecycleEvent = { kind: 'session.opened', sessionId: record.sessionId };
		this.emitter.emit('session.opened', evt);
		return record;
	}

	get(sessionId: string): SessionRecord | undefined {
		return this.records.get(sessionId);
	}

	list(): SessionRecord[] {
		return [...this.records.values()];
	}

	setStatus(sessionId: string, status: SessionStatus): SessionRecord {
		const rec = this.records.get(sessionId);
		if (!rec) throw new UnknownSessionError(sessionId);
		rec.status = status;
		const change: SessionStatusChange = { sessionId, status };
		const evt: SessionLifecycleEvent = { kind: 'session.status', change };
		this.emitter.emit('session.status', evt);
		return rec;
	}

	setProviderSessionId(sessionId: string, providerSessionId: string): SessionRecord {
		const rec = this.records.get(sessionId);
		if (!rec) throw new UnknownSessionError(sessionId);
		rec.providerSessionId = providerSessionId;
		return rec;
	}

	unregister(sessionId: string): boolean {
		const existed = this.records.delete(sessionId);
		if (existed) {
			const evt: SessionLifecycleEvent = { kind: 'session.closed', sessionId };
			this.emitter.emit('session.closed', evt);
		}
		return existed;
	}

	size(): number {
		return this.records.size;
	}

	onLifecycle(listener: (event: SessionLifecycleEvent) => void): this {
		this.emitter.on('session.opened', listener);
		this.emitter.on('session.closed', listener);
		this.emitter.on('session.status', listener);
		return this;
	}

	onAgentEvent(listener: (ev: AgentEvent) => void): this {
		this.emitter.on('agent.event', listener);
		return this;
	}

	emitAgentEvent(ev: AgentEvent): void {
		if (ev.type === 'session.state') {
			const record = this.records.get(ev.sessionId);
			if (record) {
				record.status = ev.status;
				if (ev.providerSessionId !== undefined) {
					record.providerSessionId = ev.providerSessionId;
				}
			}
		}
		const event =
			(ev.type === 'tool.started' || ev.type === 'tool.completed' || ev.type === 'tool.failed') &&
			ev.ts === undefined
				? { ...ev, ts: this.now() }
				: ev;
		this.emitter.emit('agent.event', event);
	}
}
