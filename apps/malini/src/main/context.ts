import type { MaliniDatabase } from './db/driver';
import type { EventBus } from './events';
import type { CommandRegistry } from './ipc/registry';

export interface MainContext {
	readonly db: MaliniDatabase;
	readonly commands: CommandRegistry;
	readonly events: EventBus;
	readonly appDataRoot: string;
	readonly resourcesRoot: string;
	readonly isDev: boolean;
	readonly appVersion: string;
}
