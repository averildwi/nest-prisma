# Monorepo / Turborepo support

This document is the contract for how the CLI resolves the project it should
configure. It is intentionally implemented before the workspace-aware install
logic so the two changes can be reviewed and tested separately.

## Goal

`npx @averildwi/nest-prisma` must work when it is started from either:

- the NestJS application directory (`apps/api`, `apps/backend`), or
- the workspace root (the folder that contains `turbo.json`,
  `pnpm-workspace.yaml`, or a `package.json` with `workspaces`).

It must never silently configure the wrong package.

## UX contract

```
npx @averildwi/nest-prisma [--cwd <path>] [--app <name|path>] [--pm <name>] [--dry-run] [--yes]
```

| Situation | Behaviour |
| --- | --- |
| Single-package repo, run from the project root | Same as before |
| Run from a NestJS app inside a workspace | App is used; PM and lockfile come from the workspace root |
| Run from the workspace root with exactly one NestJS app | That app is selected and shown in the plan |
| Run from the workspace root with several NestJS apps | Interactive list prompt; without a TTY it exits with code 2 and prints `--app` |
| Run from the workspace root with no NestJS app | Clean error listing the scanned workspace packages |
| Run from a non-NestJS workspace member (`packages/ui`) | Clean error listing the NestJS candidates; no silent jump |
| `--app` given | Wins over detection; accepts package name, relative path, or absolute path |
| `--cwd` given | Treats that directory as the starting point (still discovers the workspace root) |
| `--pm` given | Wins over every detection source |
| `--yes` (or no TTY) | Never prompts; ambiguity becomes an error with code 2 |
| The workspace root is itself the NestJS app | It is configured, but installs run at the root without `--workspace` |

## Resolution algorithm

1. Start at `--cwd` (resolved against `process.cwd()`) or `process.cwd()`.
2. Walk up until the repository root (nearest `.git`) or the filesystem root.
   The nearest directory that contains `pnpm-workspace.yaml`, `lerna.json`, or
   a `package.json` with `workspaces` is the workspace root. If no such marker
   exists, the nearest directory with `turbo.json` is used as a fallback.
3. Read workspace globs from `package.json#workspaces` (array or
   `{ packages: [] }`) and from `pnpm-workspace.yaml#packages`. Supported glob
   shapes: `apps/*`, `packages/*`, `packages/**`, exact paths, and `!`
   exclusions. Braces (`{apps,packages}/*`) are not supported yet.
4. Expand the globs into workspace packages. `node_modules`, `.git`, `.turbo`,
   `dist`, `build`, `coverage`, `.next`, and similar output folders are
   skipped. When no globs can be read, a depth-limited scan (3 levels) is used
   as a fallback.
5. Pick the target app:
   - `--app` (path or package name), else
   - the nearest `package.json` at or above the start directory, if it lists
     `@nestjs/core`/`@nestjs/common`, else
   - when started at the workspace root: the only NestJS candidate, or a
     prompt/error when there are several, else
   - a clean error when the start directory is a non-NestJS member.
   A candidate must list `@nestjs/core` or `@nestjs/common` and have a `src/`
   directory. A package that lists NestJS but has no `src/` still becomes the
   target so the existing preflight error is shown. A workspace root that is
   itself the app is configured, but is not treated as a member, so installs
   run at the root without `--workspace`.
6. Resolve the package manager, in order:
   - `--pm`
   - `packageManager` in the workspace root `package.json` (corepack)
   - lockfile at the workspace root: `pnpm-lock.yaml`, `yarn.lock`,
     `bun.lock`/`bun.lockb`, `package-lock.json`/`npm-shrinkwrap.json`
   - `npm_config_user_agent` (the tool that launched `npx`/`pnpm dlx`)
   - npm
7. `turbo.json` is only used to enable Turbo-specific hints in the summary. It
   never decides the app, the package manager, or the file locations.

## Package manager commands

Installation and binary execution use workspace-aware commands:

| PM | Add dependency | Run binary |
| --- | --- | --- |
| npm | `npm install <pkg> --workspace <name>` | `npm exec --workspace <name> -- <bin>` |
| pnpm | `pnpm --filter <name> add <pkg>` | `pnpm --filter <name> exec <bin>` |
| yarn | `yarn workspace <name> add <pkg>` | `yarn workspace <name> <bin>` |
| bun | `bun add <pkg>` (run in the app directory) | `bunx <bin>` (run in the app directory) |

npm, pnpm, and yarn run from the workspace root and target the member by name.
Bun has no per-workspace add flag, so the plain command runs with the app as the
working directory.

Prisma itself is executed as `node <resolved bin>` rather than through
`npx`/`pnpm exec`. The resolver walks up from the app directory, so a CLI that
npm or pnpm hoisted to the workspace root is still found without a remote
download. `--pm` still overrides detection, and a bare `npm install` inside a
workspace is never used.

## Known limitations

- Yarn PnP is not supported in this iteration. It has no `node_modules`, so the
  CLI must fail with an explicit message instead of guessing.
- Nested workspaces (a workspace package that is itself a workspace root) are
  out of scope; the nearest workspace root wins.
- Brace expansion in workspace globs is out of scope.
- The CLI does not modify `turbo.json`. Turbo hints are printed in the summary.
- `generated/prisma` is not added to `turbo.json#tasks.build.outputs`
  automatically.

## Acceptance scenarios

1. Single-package repo: plan and behaviour identical to 3.0.0.
2. npm workspace, run from `apps/api`: target is `apps/api`, PM is npm.
3. npm workspace, run from the root: target is the only NestJS app.
4. pnpm workspace with `catalog:` dependencies: PM is pnpm, no npm command is
   planned.
5. Two NestJS apps at the root: interactive prompt; `--yes` exits with code 2.
6. `--app @repo/api`, `--app apps/api`, and `--cwd <abs path>` each select the
   expected app.
7. Non-NestJS member: exits with a message that lists the candidates.
8. `node_modules` and `dist` contents never appear as candidates.
9. npm workspace with the Prisma CLI hoisted to the root: `prisma generate`
   uses the hoisted bin and does not download a remote CLI.
10. `catalog:`/`workspace:` dependencies are not reinstalled, and the saved
    command targets the workspace member (not the root package).
11. Workspace root that is itself the NestJS app: install runs at the root
    without `--workspace`.

## Test fixtures

`test/workspace.test.js` builds temporary fixtures for the scenarios above
instead of committing generated `node_modules`. `test/install.test.js` checks
the workspace command builders, semver satisfaction, hoisted binary lookup, and
the Turbo checklist. `test/package.test.js` guards the published file list and
release docs. Integration tests use `--dry-run`/`--no-install`; install
commands are tested by inspecting the argument builder, not by hitting the
network.
