import type { AgentModelInfo, ModelProviderKind } from '$contract/agent';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, isRecord, nowIso8601, parseJsonColumn, run } from '$main/db/rows';

export interface StoredProvider {
	id: string;
	name: string;
	kind: ModelProviderKind;
	baseUrl: string | null;
	models: readonly AgentModelInfo[];
	subagentModel: string | null;
	sealedKey: Uint8Array | null;
}

interface ProviderRow {
	id: string;
	name: string;
	kind: ModelProviderKind;
	base_url: string | null;
	api_key: Uint8Array | null;
	models: string;
	subagent_model: string | null;
}

const COLUMNS = 'id, name, kind, base_url, api_key, models, subagent_model';

export function listStoredProviders(db: MaliniDatabase): StoredProvider[] {
	return all<ProviderRow>(
		db,
		`SELECT ${COLUMNS} FROM model_providers ORDER BY created_at, rowid`,
	).map(fromRow);
}

export function getStoredProvider(db: MaliniDatabase, id: string): StoredProvider | null {
	const row = get<ProviderRow>(db, `SELECT ${COLUMNS} FROM model_providers WHERE id = ?`, id);
	return row ? fromRow(row) : null;
}

export function setProviderKey(db: MaliniDatabase, id: string, sealed: Uint8Array): boolean {
	return (
		run(
			db,
			'UPDATE model_providers SET api_key = ?, updated_at = ? WHERE id = ? AND kind = ?',
			sealed,
			nowIso8601(),
			id,
			'anthropic',
		).changes > 0
	);
}

export function clearProviderKey(db: MaliniDatabase, id: string): boolean {
	return (
		run(
			db,
			'UPDATE model_providers SET api_key = NULL, updated_at = ? WHERE id = ? AND kind = ?',
			nowIso8601(),
			id,
			'anthropic',
		).changes > 0
	);
}

function fromRow(row: ProviderRow): StoredProvider {
	const models = parseJsonColumn(row.models);
	return {
		id: row.id,
		name: row.name,
		kind: row.kind,
		baseUrl: row.base_url,
		models: isModelList(models) ? models : [],
		subagentModel: row.subagent_model,
		sealedKey: row.api_key,
	};
}

function isModelList(value: unknown): value is AgentModelInfo[] {
	return Array.isArray(value) && value.every(isAgentModelInfo);
}

function isAgentModelInfo(value: unknown): value is AgentModelInfo {
	return (
		isRecord(value) &&
		typeof value['id'] === 'string' &&
		typeof value['label'] === 'string' &&
		Array.isArray(value['efforts'])
	);
}
