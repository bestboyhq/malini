const GITHUB_CREDENTIAL_STORED_EVENT = 'malini-github-credential-stored';

export function publishGithubCredentialStored(): void {
	globalThis.dispatchEvent(new Event(GITHUB_CREDENTIAL_STORED_EVENT));
}

export function listenGithubCredentialStored(listener: () => void): () => void {
	globalThis.addEventListener(GITHUB_CREDENTIAL_STORED_EVENT, listener);

	return () => {
		globalThis.removeEventListener(GITHUB_CREDENTIAL_STORED_EVENT, listener);
	};
}
