# Release checklist

Run these steps from the package directory before publishing.

1. **Install exactly what CI installs**

   ```bash
   npm ci
   ```

2. **Run the test suite**

   ```bash
   npm test
   ```

   Expected: all files in `test/` pass on Node 20, 22, and 24.

3. **Inspect the published package**

   ```bash
   npm pack --dry-run
   ```

   The tarball must contain `bin/`, `src/`, `templates/`, `docs/`,
   `CHANGELOG.md`, `LICENSE`, and `README.md`. It must not contain `test/` or
   `node_modules/`.

4. **Update the changelog**

   Move the relevant `## [Unreleased]` entries in `CHANGELOG.md` under the new
   version and date. If the release changes the workspace contract, update
   `docs/monorepo.md` and the README at the same time.

5. **Bump the version**

   ```bash
   npm version <major|minor|patch> --no-git-tag-version
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "chore(release): vX.Y.Z"
   git tag vX.Y.Z
   ```

   Keep `package.json` and `package-lock.json` in sync.

6. **Publish**

   ```bash
   npm publish --access public
   git push && git push --tags
   ```

7. **Verify the published binary**

   ```bash
   npx @averildwi/nest-prisma@X.Y.Z --help
   npx @averildwi/nest-prisma@X.Y.Z --version
   ```

## Workspace smoke matrix

Local machines without pnpm/yarn/bun can only verify command construction. The
release should also be exercised on a machine with those package managers:

| Scenario | Command |
| --- | --- |
| Single npm repo, dry run | `npx @averildwi/nest-prisma --db postgres --yes --dry-run` |
| npm workspace, dry run | `npx @averildwi/nest-prisma --app @repo/api --db postgres --dry-run` |
| pnpm workspace + catalog | `npx @averildwi/nest-prisma --pm pnpm --app @repo/api --db postgres --dry-run` |
| yarn workspace | `npx @averildwi/nest-prisma --pm yarn --app @repo/api --db postgres --dry-run` |
| bun workspace | `npx @averildwi/nest-prisma --pm bun --app @repo/api --db postgres --dry-run` |
| Real install, npm | `npx @averildwi/nest-prisma --app @repo/api --db postgres --yes` |
| Real install, pnpm | `npx @averildwi/nest-prisma --pm pnpm --app @repo/api --db postgres --yes` |

For the real-install rows, confirm that:

- the install command runs from the workspace root and targets the app,
- the Prisma CLI runs through the resolved local binary, not a remote `npx`,
- `prisma/schema.prisma`, `src/prisma/`, and the app module wiring land in the
  app package,
- `turbo.json` is unchanged and the Turbo checklist is shown.

## Version/tag check

The npm `3.0.0` release came from the `v3.0.0` tag lineage. This release
(`3.1.0`) adds monorepo/Turborepo support on top of it. Before publishing,
confirm that `package.json`, `package-lock.json`, and the changelog agree on
`3.1.0`, and push a matching `v3.1.0` tag.
