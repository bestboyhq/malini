import {
	EXTENSION_EVENTS,
	type ExtensionActivationReport,
	type ExtensionWorkstream,
} from '@malini/extension-api';

import type { WorkstreamRoutineGateStore } from '$shared/extensions/automation-gate';
import type { WorkstreamRoutineDefinition } from '$shared/extensions/automation-rules.store.svelte';
import { compileWorkstreamAutomation } from '$shared/extensions/compile-automation-trigger';
import {
	PERFORMANCE_BUDGETS,
	runtimeDiagnostics,
} from '$shared/performance/runtime-diagnostics.svelte';

import type { ExtensionEventListenerFailure } from '../../domain/extension-event-listener-failure';
import {
	extensionWorkstreamPostCommitFailureDiagnostic,
	type ExtensionWorkstreamPostCommitFailure,
} from '../../domain/extension-runtime-failure';
import type { WorkstreamCreatedAutomationContext } from '../../domain/workstream-created-automation-context';
import type {
	LoadedWorkstreamExtensionConfiguration,
	WorkstreamExtensionConfiguration,
} from '../../domain/workstream-extension-configuration';
import { DesktopExtensionHost } from '../host/extension-host';
import { createDesktopExtensionState } from '../host/state.adapter';
import { extensionConfigurationReaderService } from '../services/extension-configuration-reader.service';
import { BundledExtensionRuntime } from './bundled-extension-runtime';
import { bundledExtensions } from './bundled-extensions';
import { WorkstreamExtensionAutomationRuntime } from './extension-automation-runtime';
import { LocalExtensions } from './local-extensions';

type WorkstreamExtensionConfigurationLoader = (
	workstreamId: string,
) => Promise<LoadedWorkstreamExtensionConfiguration>;

type WorkstreamRoutinesLoader = (
	workstreamId: string,
) => Promise<readonly WorkstreamRoutineDefinition[]>;

type WorkstreamExtensionsOptions = Omit<
	ConstructorParameters<typeof DesktopExtensionHost>[0],
	'workstream'
> & {
	configurationLoader?: WorkstreamExtensionConfigurationLoader;
	routinesLoader?: WorkstreamRoutinesLoader;
	routineGate?: WorkstreamRoutineGateStore;
};

export class WorkstreamExtensions {
	readonly host: DesktopExtensionHost;
	readonly runtime: BundledExtensionRuntime;
	readonly local: LocalExtensions;
	readonly automations: WorkstreamExtensionAutomationRuntime;
	readonly #loadConfiguration: WorkstreamExtensionConfigurationLoader;
	readonly #loadRoutines: WorkstreamRoutinesLoader;
	#workstream: ExtensionWorkstream | null = null;
	#transitionWorkstream: ExtensionWorkstream | null = null;
	#configuration: WorkstreamExtensionConfiguration | null = null;
	#routines: readonly WorkstreamRoutineDefinition[] = [];
	#started = false;
	readonly #postCommitEffects = new Set<Promise<void>>();

	constructor(options: WorkstreamExtensionsOptions) {
		this.host = new DesktopExtensionHost({
			...options,
			workstream: () => this.#currentWorkstream(),
		});
		this.runtime = new BundledExtensionRuntime({ createAPI: this.host.createAPI });
		this.local = new LocalExtensions({ createAPI: this.host.createAPI });
		this.automations = new WorkstreamExtensionAutomationRuntime({
			contributions: this.host.contributions,
			workstream: () => this.#currentWorkstream(),
			state: createDesktopExtensionState({
				extensionId: 'malini.workstream-automation-runtime',
				...(options.stateStorage !== undefined ? { storage: options.stateStorage } : {}),
			}),
			...(options.routineGate !== undefined ? { gate: options.routineGate } : {}),
		});
		this.#loadConfiguration =
			options.configurationLoader ??
			((workstreamId) => extensionConfigurationReaderService.load(workstreamId));
		this.#loadRoutines = options.routinesLoader ?? (() => Promise.resolve([]));
	}

	get workstream(): ExtensionWorkstream | null {
		return this.#workstream;
	}

	get configuration(): WorkstreamExtensionConfiguration | null {
		return this.#configuration;
	}

	async start(
		workstream: ExtensionWorkstream,
		options: { recoveryMode?: boolean } = {},
	): Promise<ExtensionActivationReport> {
		if (this.#started) throw new Error('Desktop bundled extensions are already started');
		const loaded = await this.#loadConfiguration(workstream.id);
		validateConfiguration(loaded.configuration);
		this.#transitionWorkstream = { ...workstream };
		this.#started = true;
		try {
			const bundled = await this.runtime.start({
				workstreamEnabled: enabledWorkstreamExtensions(loaded.configuration),
			});
			let community: ExtensionActivationReport;
			try {
				community = await this.local.start(options);
			} catch (error) {
				community = {
					activated: [],
					failed: [
						{
							id: 'malini.community-loader',
							error: error instanceof Error ? error : new Error(String(error)),
						},
					],
					skipped: [],
				};
			}
			await this.#applyConfiguredSettings(loaded.configuration);
			const routines = await this.#loadRoutines(workstream.id);
			await this.automations.configure(
				this.#configurationForActiveExtensions(loaded.configuration),
				routines,
			);
			this.#workstream = { ...workstream };
			this.#configuration = loaded.configuration;
			this.#routines = routines;
			return {
				activated: [...bundled.activated, ...community.activated],
				failed: [...bundled.failed, ...community.failed],
				skipped: [...bundled.skipped, ...community.skipped],
			};
		} catch (error) {
			const cleanup = await Promise.allSettled([
				this.automations.dispose(),
				this.local.stop(),
				this.runtime.stop(),
			]);
			this.#started = false;
			this.#workstream = null;
			this.#configuration = null;
			const cleanupFailures = cleanup.flatMap((result) =>
				result.status === 'rejected' ? [asError(result.reason)] : [],
			);
			if (cleanupFailures.length > 0) {
				throw new AggregateError(
					[asError(error), ...cleanupFailures],
					'Desktop bundled extensions failed to start and clean up',
				);
			}
			throw error;
		} finally {
			this.#transitionWorkstream = null;
		}
	}

	async setWorkstream(workstream: ExtensionWorkstream): Promise<ExtensionActivationReport> {
		const loaded = await this.#loadConfiguration(workstream.id);
		validateConfiguration(loaded.configuration);
		if (!this.#started) {
			this.#workstream = { ...workstream };
			this.#configuration = loaded.configuration;
			return emptyActivationReport();
		}
		const previous = this.#workstream ? { ...this.#workstream } : null;
		const previousConfiguration = this.#configuration;
		const previousRoutines = this.#routines;
		if (!previous || !previousConfiguration) {
			throw new Error('Desktop bundled extensions have no committed workstream to replace');
		}
		const target = { ...workstream };
		const deactivationReason =
			previous.id === target.id ? ('deactivate' as const) : ('workstream-transition' as const);
		try {
			await this.automations.suspend();
			await this.host.contributions.emit(EXTENSION_EVENTS.workstreamChanging, {
				previous,
				current: target,
			});
		} catch (error) {
			const forwardError = asError(error);
			const failures = [forwardError];
			try {
				await this.automations.configure(
					this.#configurationForActiveExtensions(previousConfiguration),
					previousRoutines,
				);
			} catch (restoreError) {
				failures.push(asError(restoreError));
			}
			throw new AggregateError(failures, 'Could not prepare extension workstream transition', {
				cause: forwardError,
			});
		}

		let report: ExtensionActivationReport;
		this.#transitionWorkstream = target;
		try {
			report = await this.runtime.setWorkstreamEnabled(
				enabledWorkstreamExtensions(loaded.configuration),
				{ deactivationReason },
			);
			await this.#applyConfiguredSettings(loaded.configuration);
			const routines = await this.#loadRoutines(target.id);
			await this.automations.configure(
				this.#configurationForActiveExtensions(loaded.configuration),
				routines,
			);
			this.#workstream = target;
			this.#configuration = loaded.configuration;
			this.#routines = routines;
		} catch (error) {
			const forwardError = asError(error);
			const rollbackFailures: Error[] = [];
			await captureFailure(rollbackFailures, () => this.automations.suspend());
			this.#transitionWorkstream = previous;
			const rollbackReports: ExtensionActivationReport[] = [];
			await captureFailure(rollbackFailures, async () => {
				rollbackReports.push(
					await this.runtime.setWorkstreamEnabled(
						enabledWorkstreamExtensions(previousConfiguration),
						{ deactivationReason },
					),
				);
			});
			for (const report of rollbackReports) {
				for (const failure of report.failed) rollbackFailures.push(failure.error);
			}
			await captureFailure(rollbackFailures, () =>
				this.#applyConfiguredSettings(previousConfiguration),
			);
			await captureFailure(rollbackFailures, () =>
				this.automations.configure(
					this.#configurationForActiveExtensions(previousConfiguration),
					previousRoutines,
				),
			);
			if (rollbackFailures.length > 0) {
				throw new AggregateError(
					[forwardError, ...rollbackFailures],
					`Extension workstream transition to ${target.id} failed and rollback was incomplete`,
					{ cause: forwardError },
				);
			}
			this.#dispatchWorkstreamPostCommitEffects(target, previous);
			throw error;
		} finally {
			this.#transitionWorkstream = null;
		}
		this.#dispatchWorkstreamPostCommitEffects(previous, target);
		return report;
	}

	async reloadRoutines(): Promise<void> {
		if (!this.#started) return;
		const workstream = this.#workstream;
		const configuration = this.#configuration;
		if (!workstream || !configuration) return;
		const routines = await this.#loadRoutines(workstream.id);
		await this.automations.configure(
			this.#configurationForActiveExtensions(configuration),
			routines,
		);
		this.#routines = routines;
	}

	async announceWorkstreamCreated(
		workstreamId: string,
		context: WorkstreamCreatedAutomationContext = {},
	): Promise<void> {
		if (!this.#started || this.#workstream?.id !== workstreamId) {
			throw new Error(`Cannot announce creation for inactive workstream ${workstreamId}`);
		}
		const missingRules = this.#missingCreationAutomationRules();
		if (missingRules.length > 0) {
			throw new Error(
				`Cannot run new-workstream automation because ${missingRules.join(', ')} did not activate`,
			);
		}
		await this.automations.announceWorkstreamCreated(context);
	}

	async announceWorkstreamArchived(workstreamId: string): Promise<void> {
		await this.host.contributions.emit<{ workstreamId: string }>(
			EXTENSION_EVENTS.workstreamArchived,
			{ workstreamId },
		);
	}

	async announceWorkstreamDeleted(workstreamId: string): Promise<void> {
		await this.host.contributions.emit<{ workstreamId: string }>(
			EXTENSION_EVENTS.workstreamDeleted,
			{ workstreamId },
		);
	}

	async stop(): Promise<void> {
		if (!this.#started) return;
		const workstream = this.#workstream;
		const failures: Error[] = [];
		try {
			await captureFailure(failures, () => this.#drainPostCommitEffects());
			await captureFailure(failures, () => this.automations.suspend());
			if (workstream) {
				await captureFailure(failures, () =>
					this.host.contributions.emit(EXTENSION_EVENTS.workstreamClosed, {
						workstreamId: workstream.id,
					}),
				);
			}
			await captureFailure(failures, () => this.automations.dispose());
			await captureFailure(failures, () => this.local.stop());
			await captureFailure(failures, () => this.runtime.stop());
		} finally {
			this.#started = false;
			this.#workstream = null;
			this.#transitionWorkstream = null;
			this.#configuration = null;
			this.#routines = [];
		}
		if (failures.length > 0) throw new AggregateError(failures, 'Extensions failed to stop');
	}

	#dispatchWorkstreamPostCommitEffects(
		previous: ExtensionWorkstream,
		current: ExtensionWorkstream,
	): void {
		const listeners = this.host.contributions.emitConcurrentSettled(
			EXTENSION_EVENTS.workstreamChanged,
			{ previous, current },
		);
		const repositoryRefresh = runtimeDiagnostics.measure(
			{
				category: 'repository',
				label: 'Refreshing repository',
				budgetMs: PERFORMANCE_BUDGETS.repositoryReadMs,
				target: current.id,
			},
			() => this.host.contributions.executeCommand('malini.repository.refresh'),
		);
		const effect = this.#runWorkstreamPostCommitEffects(
			previous,
			current,
			listeners,
			repositoryRefresh,
		).catch((error) => {
			this.#recordWorkstreamPostCommitFailures(previous, current, [
				{ effect: 'workstreamChanged', extensionId: null, error },
			]);
		});
		this.#postCommitEffects.add(effect);
		void effect.finally(() => this.#postCommitEffects.delete(effect));
	}

	async #runWorkstreamPostCommitEffects(
		previous: ExtensionWorkstream,
		current: ExtensionWorkstream,
		listeners: Promise<readonly ExtensionEventListenerFailure[]>,
		repositoryRefresh: Promise<unknown>,
	): Promise<void> {
		const [listenerResult, repositoryResult] = await Promise.allSettled([
			listeners,
			repositoryRefresh,
		] as const);
		const failures: ExtensionWorkstreamPostCommitFailure[] = [];
		if (listenerResult.status === 'fulfilled') {
			for (const failure of listenerResult.value) {
				failures.push({ effect: 'workstreamChanged', ...failure });
			}
		} else {
			failures.push({
				effect: 'workstreamChanged',
				extensionId: null,
				error: listenerResult.reason,
			});
		}
		if (repositoryResult.status === 'rejected') {
			failures.push({
				effect: 'repositoryRefresh',
				extensionId: 'malini.repository',
				error: repositoryResult.reason,
			});
		}
		this.#recordWorkstreamPostCommitFailures(previous, current, failures);
	}

	#recordWorkstreamPostCommitFailures(
		previous: ExtensionWorkstream,
		current: ExtensionWorkstream,
		failures: readonly ExtensionWorkstreamPostCommitFailure[],
	): void {
		if (failures.length === 0) return;
		console.error(
			'[malini extensions] post-commit workstream effects failed',
			extensionWorkstreamPostCommitFailureDiagnostic({
				fromWorkstreamId: previous.id,
				toWorkstreamId: current.id,
				failures,
			}),
		);
	}

	async #drainPostCommitEffects(): Promise<void> {
		while (this.#postCommitEffects.size > 0) {
			await Promise.all([...this.#postCommitEffects]);
		}
	}

	async #applyConfiguredSettings(configuration: WorkstreamExtensionConfiguration): Promise<void> {
		for (const [extensionId, entry] of Object.entries(configuration.extensions)) {
			if (!entry.enabled || this.runtime.registry.get(extensionId)?.state !== 'active') continue;
			for (const [settingId, value] of Object.entries(entry.settings)) {
				await this.host.contributions.setSetting(settingId, value);
			}
		}
	}

	#configurationForActiveExtensions(
		configuration: WorkstreamExtensionConfiguration,
	): WorkstreamExtensionConfiguration {
		return {
			...configuration,
			extensions: Object.fromEntries(
				Object.entries(configuration.extensions).filter(
					([extensionId, entry]) =>
						entry.enabled && this.runtime.registry.get(extensionId)?.state === 'active',
				),
			),
		};
	}

	#missingCreationAutomationRules(): string[] {
		if (!this.#configuration) return [];
		const active = new Set(
			this.automations.rules.map(({ extensionId, id }) => `${extensionId}\u0000${id}`),
		);
		return Object.entries(this.#configuration.extensions).flatMap(([extensionId, entry]) => {
			if (!entry.enabled) return [];
			return entry.automations.flatMap((rule) => {
				if (
					!rule.enabled ||
					compileWorkstreamAutomation(rule.when).event !== EXTENSION_EVENTS.workstreamCreated ||
					active.has(`${extensionId}\u0000${rule.id}`)
				) {
					return [];
				}
				return [`${extensionId}:${rule.id}`];
			});
		});
	}

	#currentWorkstream(): ExtensionWorkstream | null {
		return this.#transitionWorkstream ?? this.#workstream;
	}
}

function enabledWorkstreamExtensions(
	configuration: WorkstreamExtensionConfiguration,
): ReadonlySet<string> {
	return new Set(
		Object.entries(configuration.extensions)
			.filter(([, entry]) => entry.enabled)
			.map(([extensionId]) => extensionId),
	);
}

function validateConfiguration(configuration: WorkstreamExtensionConfiguration): void {
	const catalog = new Map(bundledExtensions.map((extension) => [extension.manifest.id, extension]));
	for (const [extensionId, entry] of Object.entries(configuration.extensions)) {
		const extension = catalog.get(extensionId);
		if (!extension) {
			throw new Error(`Workstream configuration references unknown extension ${extensionId}`);
		}
		const settings = new Set(extension.manifest.contributes?.settings?.map(({ id }) => id) ?? []);
		const workflows = new Set(extension.manifest.contributes?.workflows?.map(({ id }) => id) ?? []);
		const commands = new Set(extension.manifest.contributes?.commands?.map(({ id }) => id) ?? []);
		for (const settingId of Object.keys(entry.settings)) {
			if (!settings.has(settingId)) {
				throw new Error(
					`Workstream configuration references unknown setting ${settingId} for ${extensionId}`,
				);
			}
		}
		for (const automation of entry.automations) {
			if ('workflow' in automation.run && !workflows.has(automation.run.workflow)) {
				throw new Error(
					`Workstream automation ${automation.id} references unknown workflow ${automation.run.workflow}`,
				);
			}
			if ('command' in automation.run && !commands.has(automation.run.command)) {
				throw new Error(
					`Workstream automation ${automation.id} references unknown command ${automation.run.command}`,
				);
			}
		}
	}
}

function emptyActivationReport(): ExtensionActivationReport {
	return { activated: [], failed: [], skipped: [] };
}

async function captureFailure(failures: Error[], operation: () => Promise<unknown>): Promise<void> {
	try {
		await operation();
	} catch (error) {
		failures.push(asError(error));
	}
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
