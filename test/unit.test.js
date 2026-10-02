// Fast unit checks for the pure logic. Run: node test/unit.test.js
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { parseCliArgs } = require('../src/cli');
const { satisfiesNodeRange } = require('../src/preflight');
const { register, IMPORT_LINE } = require('../src/steps/registerAppModule');
const { addEntry } = require('../src/steps/updateGitignore');
const { patchSchema } = require('../src/steps/initSchema');
const { renderService } = require('../src/steps/createPrismaFiles');
const { isSatisfied } = require('../src/steps/installDeps');
const { resolveDependencies, getDatabase } = require('../src/config/registry');
const { detectPackageManager } = require('../src/utils/packageManager');

test('argv: defaults leave choices undefined so they can be prompted', () => {
    const o = parseCliArgs([]);
    assert.equal(o.database, undefined);
    assert.equal(o.runGenerate, undefined);
    assert.equal(o.yes, false);
});

test('argv: database aliases', () => {
    assert.equal(parseCliArgs(['--db', 'pg']).database, 'postgres');
    assert.equal(parseCliArgs(['--db', 'MariaDB']).database, 'mysql');
});

test('argv: --no-generate / --no-install / -y / --dry-run', () => {
    const o = parseCliArgs(['--no-generate', '--no-install', '-y', '--dry-run']);
    assert.equal(o.runGenerate, false);
    assert.equal(o.install, false);
    assert.equal(o.yes, true);
    assert.equal(o.dryRun, true);
});

test('argv: invalid values fail with exit code 2', () => {
    for (const args of [['--db', 'oracle'], ['--prisma', '6.0.0'], ['--pm', 'pip'], ['--bogus']]) {
        assert.throws(() => parseCliArgs(args), (e) => e.name === 'CliError' && e.exitCode === 2, args.join(' '));
    }
});

test('node range matches Prisma 7 engines', () => {
    const range = '^20.19 || ^22.12 || >=24.0';
    assert.ok(satisfiesNodeRange('v22.17.1', range));
    assert.ok(satisfiesNodeRange('v20.19.0', range));
    assert.ok(satisfiesNodeRange('v24.1.0', range));
    assert.ok(!satisfiesNodeRange('v20.18.0', range));
    assert.ok(!satisfiesNodeRange('v18.20.0', range));
    assert.ok(!satisfiesNodeRange('v23.5.0', range));
});

test('registry: no phantom packages', () => {
    for (const db of ['postgres', 'mysql']) {
        const { dependencies, devDependencies } = resolveDependencies({ version: '7.10.0', database: db });
        const names = [...dependencies, ...devDependencies].map((s) => s.replace(/(?<=.)@[^@/]+$/, ''));
        for (const banned of ['pg', 'mysql2', '@types/pg', '@types/mysql2', '@prisma/adapter-mysql2']) {
            assert.ok(!names.includes(banned), `${db} must not install ${banned}`);
        }
    }
    assert.equal(getDatabase('mysql').adapterPackage, '@prisma/adapter-mariadb');
    assert.equal(getDatabase('mysql').adapterClass, 'PrismaMariaDb');
});

test('service template renders with no placeholders left', () => {
    const tpl = require('fs').readFileSync(require('path').join(__dirname, '../templates/prisma/prisma.service.ts'), 'utf8');
    for (const db of ['postgres', 'mysql']) {
        const out = renderService(tpl, getDatabase(db));
        assert.doesNotMatch(out, /__ADAPTER_/);
        assert.match(out, new RegExp(`new ${getDatabase(db).adapterClass}\\(connectionString\\)`));
        assert.match(out, /from '\.\.\/generated\/prisma\/client'/);
    }
});

test('app.module registration handles every array shape', () => {
    const cases = [
        ['imports: []', 'imports: [PrismaModule]'],
        ['imports: [UsersModule]', 'imports: [PrismaModule, UsersModule]'],
        ['imports: [\n    UsersModule,\n  ]', 'imports: [\n    PrismaModule,\n    UsersModule,\n  ]'],
    ];
    for (const [before, after] of cases) {
        const src = `import { Module } from '@nestjs/common';\n\n@Module({ ${before} })\nexport class AppModule {}\n`;
        const out = register(src);
        assert.ok(out.includes(after), `expected ${JSON.stringify(after)} in\n${out}`);
        assert.ok(out.split('\n').includes(IMPORT_LINE));
        assert.ok(out.indexOf(IMPORT_LINE) < out.indexOf('@Module'));
    }
});

test('app.module: import goes after a license header, not above it', () => {
    const out = register("/* (c) 2026 */\nimport { Module } from '@nestjs/common';\n@Module({ imports: [] })\nexport class A {}\n");
    assert.ok(out.startsWith('/* (c) 2026 */'));
});

test('gitignore: replaces the stale prisma init entry and is idempotent-friendly', () => {
    const out = addEntry('node_modules\n\n/generated/prisma\n');
    assert.ok(out.includes('/src/generated/prisma'));
    assert.ok(!out.split('\n').includes('/generated/prisma'));
    assert.ok(out.endsWith('\n'));
});

test('schema: generator block forced to src/generated output', () => {
    const src = 'generator client {\n  provider = "prisma-client"\n  output   = "../generated/prisma"\n}\n\ndatasource db {\n  provider = "postgresql"\n}\n';
    const out = patchSchema(src);
    assert.match(out, /output\s+= "\.\.\/src\/generated\/prisma"/);
    assert.match(out, /moduleFormat = "cjs"/);
});

test('installDeps: detects already-satisfied specs per dependency field', () => {
    const pkg = { dependencies: { '@prisma/client': '^7.10.0', '@prisma/adapter-pg': '^7.10.0' }, devDependencies: { dotenv: '^17' } };
    assert.ok(isSatisfied('@prisma/client@7.10.0', pkg, 'dependencies'));
    assert.ok(isSatisfied('@prisma/adapter-pg', pkg, 'dependencies'));
    assert.ok(!isSatisfied('prisma@7.10.0', pkg, 'devDependencies'));
    assert.ok(!isSatisfied('@prisma/client@7.9.0', pkg, 'dependencies'));
    // dotenv only as a devDependency must still be installed as a runtime dependency.
    assert.ok(!isSatisfied('dotenv', pkg, 'dependencies'));
});

test('package manager detection priority', () => {
    const fs = require('fs');
    const path = require('path');
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pm-'));
    const saved = process.env.npm_config_user_agent;
    try {
        delete process.env.npm_config_user_agent;
        assert.deepEqual(detectPackageManager(dir), { name: 'npm', source: 'default' });
        process.env.npm_config_user_agent = 'pnpm/9.0.0 npm/? node/v22';
        assert.equal(detectPackageManager(dir).name, 'pnpm');
        fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
        assert.equal(detectPackageManager(dir).name, 'yarn');
        assert.equal(detectPackageManager(dir, 'bun').name, 'bun');
    } finally {
        if (saved === undefined) delete process.env.npm_config_user_agent;
        else process.env.npm_config_user_agent = saved;
    }
});
