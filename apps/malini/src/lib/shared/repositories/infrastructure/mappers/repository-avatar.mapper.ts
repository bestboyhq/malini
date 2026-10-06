type RawOwnerAvatar = Readonly<{
	mediaType: string;
	base64: string;
}>;

export class RepositoryAvatarMapper {
	static fromRaw(raw: RawOwnerAvatar | null): string | null {
		if (!raw) return null;
		return `data:${raw.mediaType};base64,${raw.base64}`;
	}
}
