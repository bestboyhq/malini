export type AutomationTrigger =
	| Readonly<{ kind: 'manual'; description: string }>
	| Readonly<{ kind: 'workstream-created'; description: string }>
	| Readonly<{
			kind: 'resource-ready';
			description: string;
			dockerOnly: boolean;
			frontend: boolean;
	  }>;

export const MANUAL_AUTOMATION_PHRASE = 'when I run it';

export function parseAutomationTrigger(when: string): AutomationTrigger {
	const normalized = when
		.trim()
		.toLocaleLowerCase()
		.replaceAll(/[-_]+/gu, ' ')
		.replaceAll(/\s+/gu, ' ');
	if (/\b(?:i run it|manual|manually|on demand)\b/u.test(normalized)) {
		return { kind: 'manual', description: 'Only when you run it' };
	}
	if (
		/\b(?:new\s+)?workstream\b/u.test(normalized) &&
		/\b(?:create|created|creation)\b/u.test(normalized)
	) {
		return { kind: 'workstream-created', description: 'When this workstream is created' };
	}
	const ready =
		/\b(?:boot|boots|booted|booting|ready|healthy|start|starts|started|starting|running|launch|launches|launched)\b/u.test(
			normalized,
		);
	const dockerOnly = /\b(?:docker|container)\b/u.test(normalized);
	const frontend = /\b(?:front end|frontend|web|client|ui)\b/u.test(normalized);
	const genericFrontendResource =
		frontend && /\b(?:resource|resources|service|services)\b/u.test(normalized);
	if (ready && (dockerOnly || genericFrontendResource)) {
		return {
			kind: 'resource-ready',
			description:
				dockerOnly && frontend
					? 'When a frontend Docker resource becomes ready'
					: dockerOnly
						? 'When a Docker resource becomes ready'
						: 'When a frontend resource becomes ready',
			dockerOnly,
			frontend,
		};
	}
	throw new Error(
		`Unsupported extension automation trigger ${JSON.stringify(when)}. Try “${MANUAL_AUTOMATION_PHRASE}”, “when a new workstream is created”, “when a frontend resource becomes ready”, or “when a frontend Docker container becomes ready”.`,
	);
}
