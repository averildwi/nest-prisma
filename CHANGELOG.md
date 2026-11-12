# Changelog

All notable changes to `@averildwi/nest-prisma` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [3.1.0] - 2026-11-12

### Added

- Monorepo and Turborepo support: workspace detection, automatic app
  selection, and an explicit error instead of guessing when several NestJS
  apps exist.
- CLI flags `--cwd`, `--app`, and `--pm`.
- Workspace-aware dependency installation:
  `npm --workspace`, `pnpm --filter`, `yarn workspace`, and plain `bun add` in
  the app directory.
- Semver-aware dependency checks: `catalog:`, `workspace:`, `file:`, `link:`,
  git, and HTTP specs count as already declared instead of being reinstalled.
- Hoisted Prisma CLI resolution: the local binary is executed through
  `node <bin>`, so a CLI installed at the workspace root works without a
  remote `npx prisma` download.
- Turbo checklist at the end of the run; `turbo.json` is never modified.
- `docs/monorepo.md` (workspace contract) and `docs/release.md`
  (release checklist).
- Tests for workspace resolution, install command construction, semver
  satisfaction, hoisted binary lookup, and published package metadata.

### Changed

- Yarn PnP is rejected with an explicit message instead of failing later.
- Windows package-manager commands go through a quoted shell command, which
  avoids Node 24's `DEP0190` warning while keeping `.cmd` shims working.

### Fixed

- A workspace root that is itself the NestJS app is no longer treated as a
  workspace member, so it gets a plain root install instead of
  `--workspace <root-package>`.

## [3.0.0] - 2026-10-06

### Changed

- Version-only release that supersedes 2.1.0 on npm.

## [2.1.0] - 2026-10-06

### Added

- Choice between `generated/prisma` at the project root and
  `src/generated/prisma`.
- Automatic `start:prod` and `nest-cli.json` entry alignment for the chosen
  client location.
- Jest mapping and explicit `select` documentation for the generated client.

### Changed

- The generated Prisma Client lives in `generated/prisma` by default,
  outside `src/`.

## [2.0.0] - 2026-10-06

### Added

- Redesigned CLI with a plan preview, flags, and package-manager detection.
- Prisma 7 driver-adapter setup for PostgreSQL and MySQL/MariaDB.
