import { execFileSync } from 'node:child_process';

const BREAKING_SUBJECT = /^\w+(\(.+\))?!:/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;
const FEATURE = /^feat(\(.+\))?:/;
const FIX = /^(fix|perf)(\(.+\))?:/;

/**
 * @param {string | null} last
 * @param {readonly string[]} messages
 * @returns {string | null}
 */
export function nextVersion(last, messages) {
	if (!last) return '0.1.0';
	const subjects = messages.map((message) => message.split('\n')[0] ?? '');
	const [major = 0, minor = 0, patch = 0] = last.split('.').map(Number);
	if (
		subjects.some((s) => BREAKING_SUBJECT.test(s)) ||
		messages.some((m) => BREAKING_FOOTER.test(m))
	) {
		return `${major + 1}.0.0`;
	}
	if (subjects.some((s) => FEATURE.test(s))) return `${major}.${minor + 1}.0`;
	if (subjects.some((s) => FIX.test(s))) return `${major}.${minor}.${patch + 1}`;
	return null;
}

/**
 * @param {string[]} args
 * @returns {string}
 */
function git(...args) {
	return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function lastReleaseTag() {
	try {
		return git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*').trim();
	} catch {
		return null;
	}
}

if (import.meta.main) {
	const tag = lastReleaseTag();
	const messages = tag
		? git('log', '--format=%B%x00', `${tag}..HEAD`)
				.split('\0')
				.map((message) => message.trim())
				.filter(Boolean)
		: [];
	console.log(nextVersion(tag?.slice(1) ?? null, messages) ?? '');
}
