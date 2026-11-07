export type BrainStatus = Readonly<{
	set: boolean;
	repository: string | null;
	sync: boolean;
	workstreamId: string | null;
	location: string | null;
	syncedAt: string | null;
	unpushed: number;
	problem: string | null;
}>;

export type BrainEntryKind = 'note' | 'log';

export type BrainEntry = Readonly<{
	path: string;
	kind: BrainEntryKind;
	title: string;
	updatedAt: string | null;
}>;

export type BrainDocument = BrainEntry &
	Readonly<{
		text: string;
		linkedFrom: readonly BrainEntry[];
	}>;

export type BrainCapture = Readonly<{ chats: number; turns: number; landed: boolean }>;

export type SetUpBrainArgs = Readonly<{ sync: boolean }>;

export type SetBrainSyncArgs = Readonly<{ sync: boolean }>;

export type ReadBrainArgs = Readonly<{ path: string }>;

export type BrainChangedEvent = Readonly<{ status: BrainStatus }>;
