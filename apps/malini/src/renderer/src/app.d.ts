declare global {
	namespace App {
		interface PageState {
			extensionDirectory?: {
				workstreamId: string;
				extensionId: string | null;
			};
		}
	}
}

export {};
