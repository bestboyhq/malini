import { automationName } from '$lib/automations/automations.api';
import type { MaliniNames } from '$lib/chat/domain/approval-request';
import { workstreamNameQuery } from '$shared/repositories/repositories.api';

export const MALINI_NAMES: MaliniNames = {
	automation: automationName,
	workstream: (id) => workstreamNameQuery.data(id) ?? id,
};
