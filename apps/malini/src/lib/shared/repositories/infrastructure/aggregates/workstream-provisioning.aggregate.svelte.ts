import {
	installNoticeAt,
	provisioningClonePercent,
	visibleInstallStatus,
	workstreamNativeExistence,
	type WorkstreamInstallRecord,
	type WorkstreamInstallStatusEvent,
	type WorkstreamProvisioningPhase,
	type WorkstreamProvisioningPlan,
	type WorkstreamProvisioningRecord,
} from '$shared/repositories/domain/provisioning';

export class WorkstreamProvisioningAggregate {
	records = $state<Readonly<Record<string, WorkstreamProvisioningRecord>>>({});

	begin(plan: WorkstreamProvisioningPlan): void {
		const existing = this.records[plan.workstreamId];
		this.#write(plan.workstreamId, {
			plan,
			phase: 'preparing',
			clonePercent: null,
			failure: null,
			startedAt: existing?.startedAt ?? Date.now(),
		});
	}

	advance(workstreamId: string, phase: WorkstreamProvisioningPhase): void {
		const existing = this.records[workstreamId];
		if (!existing) return;
		this.#write(workstreamId, { ...existing, phase, failure: null });
	}

	reportCloneProgress(workstreamId: string, fraction: number): void {
		const existing = this.records[workstreamId];
		if (!existing) return;
		const clonePercent = provisioningClonePercent(fraction);
		if (existing.clonePercent === clonePercent) return;
		this.#write(workstreamId, { ...existing, clonePercent });
	}

	resolveProjectRepoPath(workstreamId: string, projectRepoPath: string): void {
		const existing = this.records[workstreamId];
		if (!existing || existing.plan.projectRepoPath === projectRepoPath) return;
		this.#write(workstreamId, {
			...existing,
			plan: { ...existing.plan, projectRepoPath },
		});
	}

	fail(workstreamId: string, failure: string): void {
		const existing = this.records[workstreamId];
		if (!existing) return;
		this.#write(workstreamId, { ...existing, failure });
	}

	settle(workstreamId: string): void {
		this.discard(workstreamId);
	}

	discard(workstreamId: string): void {
		if (!this.records[workstreamId]) return;
		const next = { ...this.records };
		delete next[workstreamId];
		this.records = next;
	}

	get(workstreamId: string): WorkstreamProvisioningRecord | null {
		return this.records[workstreamId] ?? null;
	}

	hasPendingWorktree(workstreamId: string): boolean {
		return workstreamNativeExistence(this.get(workstreamId)) !== 'platform';
	}

	isProvisioning(workstreamId: string): boolean {
		return this.get(workstreamId)?.failure === null;
	}

	isFailed(workstreamId: string): boolean {
		return Boolean(this.get(workstreamId)?.failure);
	}

	hasUnstartedAttemptForProject(projectId: string): boolean {
		return Object.values(this.records).some(
			(record) =>
				record.plan.projectId === projectId &&
				record.phase === 'preparing' &&
				record.failure === null,
		);
	}

	listPending(): readonly WorkstreamProvisioningRecord[] {
		return Object.values(this.records);
	}

	reset(): void {
		this.records = {};
	}

	#write(workstreamId: string, record: WorkstreamProvisioningRecord): void {
		this.records = { ...this.records, [workstreamId]: record };
	}
}

export class WorkstreamDependencyInstallAggregate {
	records = $state<Readonly<Record<string, WorkstreamInstallRecord>>>({});

	readonly #installing = new Set<string>();

	claimInstall(workstreamId: string): boolean {
		if (this.#installing.has(workstreamId)) return false;
		this.#installing.add(workstreamId);
		return true;
	}

	releaseInstall(workstreamId: string): void {
		this.#installing.delete(workstreamId);
	}

	report(event: WorkstreamInstallStatusEvent): void {
		const workstreamId = typeof event.workstreamId === 'string' ? event.workstreamId : '';
		if (!workstreamId) return;
		const status = visibleInstallStatus(event);
		if (!status) {
			this.clear(workstreamId);
			return;
		}
		this.records = {
			...this.records,
			[workstreamId]: {
				workstreamId,
				status,
				command: typeof event.command === 'string' ? event.command : null,
				detail: typeof event.detail === 'string' && event.detail.trim() ? event.detail : null,
				noticeAt: installNoticeAt(this.get(workstreamId), status, Date.now()),
			},
		};
	}

	failLocally(workstreamId: string, detail: string): void {
		this.report({ workstreamId, status: 'failed', detail });
	}

	settleFromOutcome(workstreamId: string, outcome: string): void {
		const existing = this.get(workstreamId);
		if (existing && existing.status !== 'running') return;
		if (outcome === 'failed') {
			this.report({
				workstreamId,
				status: 'failed',
				command: existing?.command ?? null,
				detail: existing?.detail ?? null,
			});
			return;
		}
		this.clear(workstreamId);
	}

	get(workstreamId: string): WorkstreamInstallRecord | null {
		return this.records[workstreamId] ?? null;
	}

	clear(workstreamId: string): void {
		if (!this.records[workstreamId]) return;
		const next = { ...this.records };
		delete next[workstreamId];
		this.records = next;
	}

	reset(): void {
		this.records = {};
		this.#installing.clear();
	}
}

export const workstreamDependencyInstall = new WorkstreamDependencyInstallAggregate();

export const workstreamProvisioning = new WorkstreamProvisioningAggregate();
