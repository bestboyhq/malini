export type WorkstreamFile = Readonly<{
	path: string;
}>;

export type WorkstreamFileListing =
	| Readonly<{ workstreamId: string; status: 'loading' }>
	| Readonly<{ workstreamId: string; status: 'ready'; files: readonly WorkstreamFile[] }>
	| Readonly<{ workstreamId: string; status: 'failed'; error: string }>;
