# 0286 - The picker hides a model only behind a newer version of it

Status: accepted

## Context

0160 kept only the newest model of each models.dev `family`, so Opus 5.5 shows and Opus 4.8 does not.
models.dev families are coarser than models: OpenCode lists Gemini 4 Neon, Hydrogen, Carbon and Argon, four models released within five weeks, all under `gemini`, so the picker showed Neon and never the other three.
The family also joined different models into one row across providers: OpenCode's newest `gemini` was Neon and OpenCode Go's was Argon, so the row "Gemini 4 Neon" ran Argon on a Go key.
The user asked for "a system in place that will give users access to the latest models that are out there", fed by models.dev, without naming the missing releases.
models.dev also renamed DeepSeek V4 Pro's family from `deepseek-thinking` to `deepseek-pro`, so its line in `MODEL_DESCRIPTIONS`, "Thinks hard. Text only", stopped showing.

## Decision

- `catalogModel` in `src/lib/shared/providers/domain/models-dev.ts` stores a model's line as its `family`: the models.dev family, then each word of its short name that the family lacks, leaving out words with a digit, such as versions, dates, `V4` and `K3`, and the release stages preview, beta, alpha, exp, experimental and latest.
  "Gemini 4 Hydrogen" in `gemini` is `gemini-hydrogen`, "GPT-5.1 Codex Max" in `gpt-codex` is `gpt-codex-max`, "Hy4 preview" in `hy` stays `hy`, and "Opus 5.5" in `claude-opus` stays `claude-opus`.
- `modelsDevModels` keeps the newest model of each line, and `pickerRows` builds one row per line, with no change of their own, since both already key on `family`.
- A GPT line matches what `chatGptFamily` makes of the same model's slug, such as `gpt-luna` from both, so ChatGPT and OpenCode still share a row.
- `MODEL_DESCRIPTIONS` in `src/lib/shared/providers/domain/model-catalog.ts` keys DeepSeek V4 Pro as `deepseek-pro`.
- No migration: the read at launch rewrites every stored list.

## Consequences

- On models.dev of 2026-11-22, OpenCode lists 38 models instead of 34, adding Gemini 4 Hydrogen, Carbon and Argon and GPT-5.1 Codex Max, and OpenCode Go lists Muse Spark 1.3 Contributor apart from OpenCode's Muse Spark 1.3.
- A new model shows at the next models.dev read and hides only the older versions of its own line.
- A line that a newer one replaces under another name, such as GPT-5.1 Codex Max beside GPT-5.3 Codex, stays listed until the provider stops selling it.
- A release stage the list lacks, such as `rc`, gives a preview a line of its own beside its release.
- A `MODEL_DESCRIPTIONS` key that models.dev renames falls back to the models.dev description, and nothing checks for it.
- Enforced by `models-dev.test.ts` (each line of a family, release stages, the newest version per line) and `tests/e2e/provider-models.spec.ts` (two lines of one OpenCode family show as two rows, and an older version of a line does not).
