import type { RoutineRecord } from '$contract/routines';
import type { MaliniDatabase } from '$main/db/driver';
import { listRoutines } from './platform/routines.repository';

export interface RoutinesPlatform {
	dispose(): void;
}

export function routines(db: MaliniDatabase): RoutineRecord[] {
	return listRoutines(db);
}
