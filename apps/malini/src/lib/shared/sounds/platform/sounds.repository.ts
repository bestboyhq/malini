import { randomUUID } from 'node:crypto';
import type { CustomSound, CustomSoundKind, SoundBytes } from '$contract/sounds';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, nowIso8601, run } from '$main/db/rows';
import { isCustomSoundKind } from '../domain/sounds';

type CustomSoundRow = { id: string; label: string; kind: string; created_at: string };

export type NewCustomSound = Readonly<{
	label: string;
	kind: CustomSoundKind;
	mediaType: string;
	bytes: Uint8Array;
}>;

export function listCustomSounds(db: MaliniDatabase): CustomSound[] {
	return all<CustomSoundRow>(
		db,
		'SELECT id, label, kind, created_at FROM custom_sounds ORDER BY created_at, rowid',
	).flatMap((row) =>
		isCustomSoundKind(row.kind)
			? [{ id: row.id, label: row.label, kind: row.kind, createdAt: row.created_at }]
			: [],
	);
}

export function readCustomSound(db: MaliniDatabase, id: string): SoundBytes | null {
	const row = get<{ media_type: string; bytes: Uint8Array }>(
		db,
		'SELECT media_type, bytes FROM custom_sounds WHERE id = ?',
		id,
	);
	return row ? { mediaType: row.media_type, bytes: new Uint8Array(row.bytes) } : null;
}

export function addCustomSound(db: MaliniDatabase, sound: NewCustomSound): CustomSound {
	const added: CustomSound = {
		id: `custom-${randomUUID()}`,
		label: sound.label,
		kind: sound.kind,
		createdAt: nowIso8601(),
	};
	run(
		db,
		'INSERT INTO custom_sounds (id, label, kind, media_type, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
		added.id,
		added.label,
		added.kind,
		sound.mediaType,
		sound.bytes,
		added.createdAt,
	);
	return added;
}
