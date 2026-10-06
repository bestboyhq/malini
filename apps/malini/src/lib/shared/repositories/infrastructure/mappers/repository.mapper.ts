import type { Repository } from '$shared/repositories/domain/repository';

type RawRepository = {
	id: string;
	fullName: string;
	defaultBranch: string;
	localPath?: string | null;
	remoteUrl?: string | null;
	createdAt: string;
};

export class RepositoryMapper {
	static fromRaw(raw: unknown): Repository | null {
		if (!isRawRepository(raw)) return null;
		return {
			id: raw.id,
			fullName: raw.fullName,
			defaultBranch: raw.defaultBranch,
			localPath: typeof raw.localPath === 'string' ? raw.localPath : null,
			remoteUrl: typeof raw.remoteUrl === 'string' ? raw.remoteUrl : null,
			createdAt: raw.createdAt,
		};
	}

	static fromRawList(raws: unknown): Repository[] {
		if (!Array.isArray(raws)) return [];
		return raws.flatMap((raw) => {
			const repository = RepositoryMapper.fromRaw(raw);
			return repository ? [repository] : [];
		});
	}
}

function isRawRepository(value: unknown): value is RawRepository {
	if (!isRecord(value)) return false;
	if (typeof value.id !== 'string') return false;
	if (typeof value.fullName !== 'string') return false;
	if (typeof value.defaultBranch !== 'string') return false;
	if (typeof value.createdAt !== 'string') return false;
	if (!isOptionalText(value.localPath)) return false;
	return isOptionalText(value.remoteUrl);
}

function isOptionalText(value: unknown): boolean {
	return value === undefined || value === null || typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
