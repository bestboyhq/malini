# 0003 - Code lives in vertical domain slices

Status: accepted

## Context

Each malini capability (chat, pull requests, jobs, routines, extensions) spans both processes: views and stores in the renderer, services and SQL in the main process.
Folders named by technology spread one capability across many places and let any file import any other, so a change touches everything and coupling stays invisible.

## Decision

- One folder per domain under `apps/malini/src/lib/<domain>/`, named with the user's word for it.
- A domain holds its renderer layers `domain/`, `application/`, `infrastructure/` and `presentation/`, and its main-process code in `platform/`.
- `domain/` is pure TypeScript, type-checked by both the web and the node project.
- Other domains see it only through `<domain>.api.ts` in the renderer and `<domain>.platform.ts` in the main process.
- `app` is the consumer domain that may use every other one; `$shared/repositories` and `$shared/providers` are shared domains.
- The main process boots each domain with one `register<Domain>(context, deps)` call in `src/main/modules.ts`.

## Consequences

- A feature mostly changes one folder, and every cross-domain dependency is visible in an api or platform file.
- Code two domains need has to find a home: a shared domain, or a flat `$shared/<util>` module.
- Enforced by `@malini/desktop/domain-boundaries` (`packages/eslint-plugin-hyper-ui/src/domain-boundaries.mjs`) at `error` over `src/**` and `tests/**`.
- The full tree and import rules are in `.agents/rules/frontend/layout.mdc`, `cross-domain-imports.mdc` and `layers/`.
