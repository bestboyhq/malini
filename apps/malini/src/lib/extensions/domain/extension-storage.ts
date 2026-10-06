export type ExtensionStateStorage = {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
};

export type ExtensionSettingStorage = {
	get(key: string): string | null;
	set(key: string, value: string): void;
	delete(key: string): void;
};
