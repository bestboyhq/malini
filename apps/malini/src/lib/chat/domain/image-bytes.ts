export type ImageBytes = Readonly<{
	mediaType: string;
	data: Uint8Array<ArrayBuffer>;
}>;
