# @averildwi/nest-prisma

[![npm version](https://img.shields.io/npm/v/@averildwi/nest-prisma.svg)](https://www.npmjs.com/package/@averildwi/nest-prisma)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%5E20.19%20%7C%7C%20%5E22.12%20%7C%7C%20%3E%3D24-brightgreen)](https://nodejs.org)
[![NestJS](https://img.shields.io/badge/NestJS-v11-red)](https://nestjs.com)

An interactive CLI that sets up [Prisma ORM](https://www.prisma.io/) 7 with a
driver adapter inside an existing [NestJS](https://nestjs.com/) project. One
command installs the packages, creates the schema, writes `PrismaService` and
`PrismaModule`, registers the module, and generates the client.

## Quick start

Run it from the root of your NestJS project:

```bash
npx @averildwi/nest-prisma
```

The CLI asks which database you use, shows the full list of planned changes,
and applies them only after you confirm.

```
  Planned changes
    $ npm install @prisma/client@7.10.0 @prisma/adapter-pg dotenv
    $ npm install --save-dev prisma@7.10.0
    $ npx prisma init --datasource-provider postgresql --output ../src/generated/prisma --no-skills
    + prisma/schema.prisma (generator set for the driver adapter)
    + src/prisma/prisma.service.ts
    + src/prisma/prisma.module.ts
    ~ src/app.module.ts (add PrismaModule to imports)
    ~ .gitignore (add /src/generated/prisma)
    ~ tsconfig.build.json (exclude the Prisma config file)
    $ npx prisma generate

? Apply these changes? (Y/n)
```

## Options

| Option | Description |
|---|---|
| `--db <name>` | `postgres` or `mysql` (aliases: `pg`, `postgresql`, `mariadb`) |
| `--prisma <ver>` | Prisma version to install (default: latest supported) |
| `--pm <name>` | `npm`, `pnpm`, `yarn` or `bun` (default: auto-detect) |
| `--output <loc>` | Where the generated client lives: `src` (default) or `root` |
| `--no-generate` | Skip `prisma generate` |
| `--no-install` | Only write files, don't install packages |
| `-y, --yes` | Skip prompts and use defaults |
| `--dry-run` | Show the plan without changing anything |
| `--no-color` | Disable colours (`NO_COLOR` is respected too) |
| `-v, --version` / `-h, --help` | Version / help |

### Client output location

By default the generated Prisma Client lives inside `src/generated/prisma`.
This keeps the TypeScript `rootDir` narrow, so `nest build` emits
`dist/main.js` and `npm run start:prod` works untouched.

Choosing `--output root` places it in `generated/prisma` instead. The client
then sits outside `src/`, TypeScript widens its `rootDir`, and the build emits
`dist/src/main.js` — so the CLI automatically:

- sets `start:prod` to `node dist/src/main`
- sets `compilerOptions.entryFile` to `src/main` in `nest-cli.json`
  (this is what `nest start` / `nest build` run)

Switching the location later is safe: re-run the CLI with the other
`--output` value and it re-aligns the schema, the `PrismaService` import, the
`.gitignore` entries and the prod entry points, warning you about a stale
generated client left behind.

Non-interactive use (CI, scripts):

```bash
npx @averildwi/nest-prisma --db postgres --yes
```

Without a TTY the CLI never waits for input. If `--db` is missing it exits with
code 2 and tells you what to pass.

The package manager is picked from `--pm`, then the lockfile, then the command
that launched the CLI (for example `pnpm dlx`), then npm.

## Supported databases

| Database | Adapter | Class |
|---|---|---|
| PostgreSQL | `@prisma/adapter-pg` | `PrismaPg` |
| MySQL / MariaDB / Percona | `@prisma/adapter-mariadb` | `PrismaMariaDb` |

Each adapter brings its own database driver, so `pg` or `mysql2` are not
installed separately.

## What gets generated

```typescript
// src/prisma/prisma.service.ts
import 'dotenv/config';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set. Add it to your .env file before starting the app.');
    }
    super({ adapter: new PrismaPg(connectionString) });
  }

  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```

`PrismaModule` is `@Global()` and is added to the `imports` of `AppModule`, so
`PrismaService` can be injected anywhere:

```typescript
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.user.findMany();
  }
}
```

## After setup

1. Set `DATABASE_URL` in `.env`.
2. Add models to `prisma/schema.prisma` and run `npx prisma migrate dev --name init`.
3. Start the app with `npm run start:dev`.

## Behaviour notes

- **Safe to re-run.** Each step checks the project first and skips work that is
  already done. Running the CLI on a configured project prints
  "Nothing to do".
- **Fails with a clear report.** If a step fails, the CLI lists the steps that
  finished and the files that changed, so you know the state of the project.
  Fix the problem and run the command again.
- **Checks the project first.** It refuses to run outside a NestJS project
  (`@nestjs/core` must be in `package.json`), on an unsupported Node version, or
  in an ESM (`"type": "module"`) project.
- **The client lives in `src/generated/prisma`.** Generating it inside `src/`
  keeps Nest's build output at `dist/main.js`. The folder is added to
  `.gitignore`.
- **The Prisma config file is excluded from the build.** `prisma init` creates a
  `.ts` config at the project root. The CLI adds it to the `exclude` list in
  `tsconfig.build.json` so `npm run start:prod` keeps working.
- **Prisma 8 is not supported yet.** Prisma 8 replaces `@prisma/client` with new
  packages and a different API. It will be added once it has a stable release.

## Development

```bash
npm install
npm test        # unit tests (node:test, no extra dependencies)
npm link        # makes the `nest-prisma` command point at this checkout
```

To test end to end, create a throwaway project and run the CLI inside it:

```bash
nest new demo --package-manager npm --skip-git
cd demo
nest-prisma --db postgres --dry-run   # check the plan
nest-prisma --db postgres --yes       # apply it
npm run build                         # must produce dist/main.js
nest-prisma --db postgres --yes       # must print "Nothing to do"
```

## License

MIT
