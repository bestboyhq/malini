# 0072 - Malini keeps the Claude accounts you switch away from signed in

Status: accepted

## Context

**Switch to** in the model picker and in Settings ran `claude auth login --email=<account>`, so every switch between two Claude accounts went through the browser sign-in again.
The user asked for both accounts to stay signed in, one click to switch, and nothing to see while it happens.
Claude Code keeps one sign-in per config folder: on macOS the keychain item `Claude Code-credentials`, or `Claude Code-credentials-<first 8 hex of sha256(CLAUDE_CONFIG_DIR)>` for another folder, holding `claudeAiOauth` with a refresh token and its scopes.
In Claude Code 2.1.293, `claude auth login` signs in without a browser when `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` and `CLAUDE_CODE_OAUTH_SCOPES` are set.
A refresh token works once, each refresh returns a new one, and the sign-in ends at a fixed time about four weeks after the browser sign-in: two refreshes four minutes apart both reported the expiry `2026-11-21T12:17:32Z`.
A config folder per account would keep both signed in at once, but it splits settings, skills, MCP servers and conversations; `CLAUDE_SECURESTORAGE_CONFIG_DIR`, which separates only the sign-in, is undocumented; and a `claude setup-token` token only runs models, so claude.ai connectors stop working.

## Decision

- `ClaudeAccounts` (`src/lib/shared/providers/platform/claude-accounts.service.ts`) parks the account you leave.
  Before a sign-in or a switch replaces it, it reads that account's refresh token, scopes and client id (`claude-logins.ts`, through `security` or `.credentials.json`) and its email from `claude auth status --json`.
- It keeps up to five parked accounts, encrypted with Electron's `safeStorage`, in `<app data>/claude-accounts/saved-logins`, and saves nothing when encryption is unavailable.
- `providers.switch-claude-account { email }` signs in with the parked token through `claude auth login` and those two variables, then parks the account it left.
  It answers `sign-in-needed` when no token is parked or Claude Code refuses it, which drops that token.
  The renderer then runs the browser sign-in, `providers.sign-in-to-claude`, which parks the account it replaces too.
- Sign-in and switch run one at a time, so two of them never spend the same token.
- Parked tokens are not renewed in the background: a refresh does not move the expiry, so a renewal would only spend tokens.
  An account whose sign-in ended signs in through the browser again on its next switch.
- Malini only reads Claude Code's sign-in; Claude Code writes every sign-in and is the only one that calls Anthropic's token endpoint, so Malini adds no outbound call of its own (0058).
- The bridge's config snapshot stamps `oauthAccount.accountUuid` and `organizationUuid` from `~/.claude.json`, so after a switch each chat's idle Claude Code and the MCP watchers restart on the new account at their next use (0038, 0062).

## Consequences

- Switching to an account you already used takes one click and no browser, until that account's sign-in ends, about four weeks after its last browser sign-in.
- A switch applies to Claude Code everywhere, the terminal included, as it did before.
- Malini depends on Claude Code's sign-in storage and its refresh-token login; when either changes, reading fails, nothing is parked, and switching falls back to the browser.
- A refresh of the outgoing account while the browser sign-in is open spends the token parked for it, and that account signs in through the browser once more; the code marks this with a `ponytail:` comment.
- `claude-accounts.service.test.ts` runs sign-in, switch, fallback and cancel against a fake `claude` and `security` that rotate tokens the way Anthropic does, and `claude-logins.test.ts` pins the keychain names Claude Code uses.
- `claude-account-switch.spec.ts` switches in one click while the browser sign-in would hang, and the e2e harness stubs `security` for every spec and launches with `--use-mock-keychain`, so no test reads the real keychain.
- `config-snapshot.test.ts` fails when an account switch stops restarting Claude Code, or when the account details Claude Code refreshes start restarting it.
