import { format } from 'node:util';
import type {
	MainDiagnosticEvent,
	MainDiagnosticLevel,
	MainDiagnosticsLog,
} from './main-diagnostics';
import { stringProperty, thrownDetail } from './thrown';

type ConsoleMethod = (...values: unknown[]) => void;

export interface CapturableConsole {
	info: ConsoleMethod;
	warn: ConsoleMethod;
	error: ConsoleMethod;
}

export interface MainProcessHooks {
	readonly console: CapturableConsole;
	onUnhandledRejection(listener: (reason: unknown) => void): () => void;
	onUncaughtException(listener: (error: unknown) => void): () => void;
	onWarning(listener: (warning: Error) => void): () => void;
}

export function captureMainProcess(log: MainDiagnosticsLog, hooks: MainProcessHooks): () => void {
	const target = hooks.console;
	const originalInfo = target.info;
	const originalWarn = target.warn;
	const originalError = target.error;
	const captured = (level: MainDiagnosticLevel, original: ConsoleMethod): ConsoleMethod => {
		return (...values: unknown[]): void => {
			try {
				original.apply(target, values);
			} finally {
				if (!isProcessWarningEcho(values)) recordQuietly(log, () => consoleEvent(level, values));
			}
		};
	};
	const capturedInfo = captured('info', originalInfo);
	const capturedWarn = captured('warn', originalWarn);
	const capturedError = captured('error', originalError);
	target.info = capturedInfo;
	target.warn = capturedWarn;
	target.error = capturedError;

	const stopWarnings = hooks.onWarning((warning) => {
		recordQuietly(log, () => ({
			level: 'warn',
			source: 'process-warning',
			message: `${warning.name}: ${warning.message}`,
			error: warning,
		}));
	});

	const stopRejections = hooks.onUnhandledRejection((reason) => {
		originalError.call(target, 'malini: unhandled promise rejection in the main process:', reason);
		log.record({
			level: 'error',
			source: 'unhandled-rejection',
			message: messageOf(reason),
			error: reason,
		});
	});
	const stopExceptions = hooks.onUncaughtException((error) => {
		originalError.call(target, 'malini: uncaught exception in the main process:', error);
		log.record({
			level: 'error',
			source: 'uncaught-exception',
			message: messageOf(error),
			error,
		});
	});

	return () => {
		stopWarnings();
		stopRejections();
		stopExceptions();
		if (target.info === capturedInfo) target.info = originalInfo;
		if (target.warn === capturedWarn) target.warn = originalWarn;
		if (target.error === capturedError) target.error = originalError;
	};
}

export function nodeProcessHooks(
	target: NodeJS.EventEmitter = process,
	output: CapturableConsole = console,
): MainProcessHooks {
	return {
		console: output,
		onUnhandledRejection(listener) {
			const onRejection = (reason: unknown): void => listener(reason);
			target.on('unhandledRejection', onRejection);
			return () => {
				target.off('unhandledRejection', onRejection);
			};
		},
		onWarning(listener) {
			const onWarning = (warning: Error): void => listener(warning);
			target.on('warning', onWarning);
			return () => {
				target.off('warning', onWarning);
			};
		},
		onUncaughtException(listener) {
			const onException = (error: Error, origin: NodeJS.UncaughtExceptionOrigin): void => {
				if (origin === 'uncaughtException') listener(error);
			};
			target.on('uncaughtException', onException);
			return () => {
				target.off('uncaughtException', onException);
			};
		},
	};
}

function consoleEvent(level: MainDiagnosticLevel, values: readonly unknown[]): MainDiagnosticEvent {
	const error = values.find((value) => value instanceof Error);
	const workstreamId =
		values.map((value) => stringProperty(value, 'workstreamId')).find((id) => id !== null) ?? null;
	return {
		level,
		source: 'console',
		message: formatted(values),
		...(error === undefined ? {} : { error }),
		workstreamId,
	};
}

const PROCESS_WARNING_ECHO = /^\(node:\d+\) /u;

function isProcessWarningEcho(values: readonly unknown[]): boolean {
	const [first] = values;
	return values.length === 1 && typeof first === 'string' && PROCESS_WARNING_ECHO.test(first);
}

function recordQuietly(log: MainDiagnosticsLog, event: () => MainDiagnosticEvent): void {
	try {
		log.record(event());
	} catch {
		return;
	}
}

function formatted(values: readonly unknown[]): string {
	try {
		return format(...values);
	} catch {
		return `${values.length} unprintable console values`;
	}
}

function messageOf(value: unknown): string {
	const detail = thrownDetail(value);
	return detail.reason || `no reason given, threw ${detail.shape}`;
}
