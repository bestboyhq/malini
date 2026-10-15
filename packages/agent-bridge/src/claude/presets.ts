import { tmpdir } from 'node:os';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { AgentPresetSuggestion, AgentSkillSummary } from '../protocol.js';
import { isRecord } from '../type-guards.js';
import { findClaudeExecutable } from './installation.js';
import { claudeEnvironment } from './session.js';

const PRESETS_TIMEOUT_MS = 45_000;
const MAX_PRESETS = 5;
const MIN_PRESET_SKILLS = 2;
const MAX_PRESET_NAME_CHARACTERS = 40;
const MAX_EMOJI_LENGTH = 32;
const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' });
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

const PRESETS_SCHEMA = {
	type: 'object',
	properties: {
		presets: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					name: { type: 'string' },
					emoji: { type: 'string' },
					skills: { type: 'array', items: { type: 'string' } },
				},
				required: ['name', 'emoji', 'skills'],
			},
		},
	},
	required: ['presets'],
};

export interface PresetJob {
	readonly instructions: string;
	readonly model: string;
}

export interface PresetOptions {
	readonly findExecutable?: () => string | null;
	readonly query?: typeof sdkQuery;
}

export async function suggestClaudePresets(
	skills: readonly AgentSkillSummary[],
	job: PresetJob,
	options: PresetOptions = {},
): Promise<AgentPresetSuggestion[]> {
	const executable = (options.findExecutable ?? findClaudeExecutable)();
	if (!executable) throw new Error('Claude Code is not installed');
	const abortController = new AbortController();
	const timeout = setTimeout(() => abortController.abort(), PRESETS_TIMEOUT_MS);
	try {
		const conversation = (options.query ?? sdkQuery)({
			prompt: `<skills>\n${skills.map(skillLine).join('\n')}\n</skills>`,
			options: {
				cwd: tmpdir(),
				abortController,
				pathToClaudeCodeExecutable: executable,
				env: claudeEnvironment(),
				...(job.model === 'default' ? {} : { model: job.model }),
				systemPrompt: job.instructions,
				tools: [],
				maxTurns: 3,
				thinking: { type: 'disabled' },
				settingSources: ['user'],
				settings: { disableAllHooks: true },
				mcpServers: {},
				strictMcpConfig: true,
				persistSession: false,
				outputFormat: { type: 'json_schema', schema: PRESETS_SCHEMA },
			},
		});
		for await (const message of conversation) {
			if (message.type !== 'result') continue;
			if (message.subtype !== 'success' || message.is_error) {
				throw new Error(`Claude Code could not suggest presets: ${message.subtype}`);
			}
			const presets = cleanPresetSuggestions(
				message.structured_output,
				skills.map(({ name }) => name),
			);
			if (presets.length === 0) throw new Error('Claude Code suggested no usable presets');
			return presets;
		}
		throw new Error('Claude Code stopped without suggesting presets');
	} finally {
		clearTimeout(timeout);
	}
}

export function cleanPresetSuggestions(
	output: unknown,
	skillNames: readonly string[],
): AgentPresetSuggestion[] {
	if (!isRecord(output) || !Array.isArray(output.presets)) return [];
	const resolve = skillResolver(skillNames);
	const taken = new Set<string>();
	const presets: AgentPresetSuggestion[] = [];
	for (const preset of output.presets) {
		if (!isRecord(preset) || typeof preset.name !== 'string') continue;
		if (!Array.isArray(preset.skills)) continue;
		const name = preset.name.replace(/\s+/gu, ' ').trim();
		const key = name.toLocaleLowerCase();
		if (name.length === 0 || [...name].length > MAX_PRESET_NAME_CHARACTERS) continue;
		if (taken.has(key)) continue;
		const skills = [
			...new Set(
				preset.skills.flatMap((skill) => {
					const known = typeof skill === 'string' ? resolve(skill) : null;
					return known === null ? [] : [known];
				}),
			),
		];
		if (skills.length < MIN_PRESET_SKILLS) continue;
		taken.add(key);
		const emoji = typeof preset.emoji === 'string' ? firstEmoji(preset.emoji) : null;
		presets.push({ name, ...(emoji === null ? {} : { emoji }), skills });
	}
	return presets.slice(0, MAX_PRESETS);
}

function skillResolver(skillNames: readonly string[]): (reply: string) => string | null {
	const exact = new Set(skillNames);
	const byShortName = new Map<string, string | null>();
	for (const name of skillNames) {
		const short = shortName(name);
		byShortName.set(short, byShortName.has(short) ? null : name);
	}
	return (reply) => {
		const name = reply.trim();
		if (exact.has(name)) return name;
		return byShortName.get(shortName(name)) ?? null;
	};
}

function firstEmoji(text: string): string | null {
	for (const { segment } of GRAPHEMES.segment(text)) {
		if (PICTOGRAPH.test(segment) && segment.length <= MAX_EMOJI_LENGTH) return segment;
	}
	return null;
}

function shortName(name: string): string {
	return name.slice(name.lastIndexOf(':') + 1);
}

function skillLine({ name, description }: AgentSkillSummary): string {
	const text = description.replace(/\s+/gu, ' ').trim();
	return text.length > 0 ? `- ${name}: ${text}` : `- ${name}`;
}
