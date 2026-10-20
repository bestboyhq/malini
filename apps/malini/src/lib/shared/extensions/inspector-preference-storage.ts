export type InspectorPreferenceStorage = Readonly<{
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}>;
