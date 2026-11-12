// Workspace installs and local binary resolution. Run: node --test test/install.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const installStep = require('../src/steps/installDeps');
const { isSatisfied, satisfiesRange, addArgs, devArgs, installCwd } = installStep;
const { PACKAGE_MANAGERS } = require('../src/utils/packageManager');
const { findPackageFile, resolvePackageBin, ensureLocalPrisma } = require('../src/steps/helpers');
const { buildContext, printSummary } = require('../src/runner');

function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-prisma-install-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function workspaceContext(pmName) {
    return {
        pm: PACKAGE_MANAGERS[pmName],
        workspaceRoot: path.resolve('/repo'),
        projectRoot: path.resolve('/repo/apps/api'),
        packageName: '@repo/api',
        appRel: 'apps/api',
        isWorkspaceMember: true,
    };
}

test('installDeps: catalog/workspace/file/git protocols count as declared', () => {
    const pkg = {
        dependencies: {
            '@nestjs/common': 'catalog:',
            '@nestjs/core': 'workspace:*',
            local: 'file:../../packages/local',
            linked: 'link:../shared',
            alias: 'npm:real-package@1.2.3',
            git: 'git+https://example.com/repo.git',
        },
    };

    for (const name of Object.keys(pkg.dependencies)) {
        assert.ok(isSatisfied(`${name}@7.10.0`, pkg, 'dependencies'), name);
    }
});

test('installDeps: minimal semver ranges match the requested target', () => {
    const pkg = {
        dependencies: {
            caret: '^7.10.0',
            tilde: '~7.10.0',
            atLeast: '>=7.0.0',
            exact: '7.10.0',
            wildcard: '*',
        },
    };

    assert.ok(isSatisfied('caret@7.10.0', pkg, 'dependencies'));
    assert.ok(isSatisfied('caret@7.11.0', pkg, 'dependencies'));
    assert.ok(!isSatisfied('caret@7.9.0', pkg, 'dependencies'));
    assert.ok(!isSatisfied('caret@8.0.0', pkg, 'dependencies'));

    assert.ok(isSatisfied('tilde@7.10.9', pkg, 'dependencies'));
    assert.ok(!isSatisfied('tilde@7.11.0', pkg, 'dependencies'));

    assert.ok(isSatisfied('atLeast@7.5.0', pkg, 'dependencies'));
    assert.ok(!isSatisfied('atLeast@6.9.0', pkg, 'dependencies'));

    assert.ok(isSatisfied('exact@7.10.0', pkg, 'dependencies'));
    assert.ok(!isSatisfied('exact@7.10.1', pkg, 'dependencies'));

    assert.ok(isSatisfied('wildcard@9.9.9', pkg, 'dependencies'));

    // Caret is stricter for 0.x releases.
    assert.ok(satisfiesRange('^0.2.3', '0.2.9'));
    assert.ok(!satisfiesRange('^0.2.3', '0.3.0'));
    assert.ok(satisfiesRange('^0.0.3', '0.0.3'));
    assert.ok(!satisfiesRange('^0.0.3', '0.0.4'));
});

test('installDeps: workspace commands target the member from the root', () => {
    for (const pm of ['npm', 'pnpm', 'yarn']) {
        const ctx = workspaceContext(pm);
        assert.equal(installCwd(ctx), path.resolve('/repo'), pm);
    }

    assert.deepEqual(addArgs(workspaceContext('npm'), ['prisma@7.10.0'], []), [
        'install',
        'prisma@7.10.0',
        '--workspace',
        '@repo/api',
    ]);
    assert.deepEqual(devArgs(workspaceContext('npm'), ['prisma@7.10.0']), [
        'install',
        '--save-dev',
        'prisma@7.10.0',
        '--workspace',
        '@repo/api',
    ]);
    assert.deepEqual(addArgs(workspaceContext('npm'), ['dotenv'], ['dotenv']), [
        'install',
        'dotenv',
        '--workspace',
        '@repo/api',
        '--save-prod',
    ]);

    assert.deepEqual(addArgs(workspaceContext('pnpm'), ['prisma@7.10.0'], []), [
        '--filter',
        '@repo/api',
        'add',
        'prisma@7.10.0',
    ]);
    assert.deepEqual(devArgs(workspaceContext('pnpm'), ['prisma@7.10.0']), [
        '--filter',
        '@repo/api',
        'add',
        '-D',
        'prisma@7.10.0',
    ]);

    assert.deepEqual(addArgs(workspaceContext('yarn'), ['prisma@7.10.0'], []), [
        'workspace',
        '@repo/api',
        'add',
        'prisma@7.10.0',
    ]);
    assert.deepEqual(devArgs(workspaceContext('yarn'), ['prisma@7.10.0']), [
        'workspace',
        '@repo/api',
        'add',
        '-D',
        'prisma@7.10.0',
    ]);
});

test('installDeps: bun installs from the app directory without a workspace flag', () => {
    const ctx = workspaceContext('bun');
    assert.equal(installCwd(ctx), path.resolve('/repo/apps/api'));
    assert.deepEqual(addArgs(ctx, ['prisma@7.10.0'], []), ['add', 'prisma@7.10.0']);
    assert.deepEqual(devArgs(ctx, ['prisma@7.10.0']), ['add', '-d', 'prisma@7.10.0']);
});

test('installDeps: plan uses workspace-aware labels', async () => {
    const plan = await installStep.plan({
        install: true,
        dependencies: ['@prisma/client@7.10.0', '@prisma/adapter-pg', 'dotenv'],
        devDependencies: ['prisma@7.10.0'],
        pkgJson: { dependencies: {}, devDependencies: {} },
        ...workspaceContext('pnpm'),
    });

    assert.equal(plan.entries.length, 2);
    assert.equal(
        plan.entries[0].label,
        'pnpm --filter @repo/api add @prisma/client@7.10.0 @prisma/adapter-pg dotenv',
    );
    assert.equal(plan.entries[1].label, 'pnpm --filter @repo/api add -D prisma@7.10.0');
});

test('helpers: a hoisted package is found from the app directory', (t) => {
    const root = fixture(t);
    const app = path.join(root, 'apps', 'api');
    fs.mkdirSync(path.join(root, 'node_modules', 'prisma', 'build'), { recursive: true });
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(
        path.join(root, 'node_modules', 'prisma', 'package.json'),
        `${JSON.stringify({ name: 'prisma', bin: { prisma: 'build/index.js' } })}\n`,
    );
    fs.writeFileSync(path.join(root, 'node_modules', 'prisma', 'build', 'index.js'), '');

    assert.equal(
        findPackageFile(app, 'prisma'),
        path.join(root, 'node_modules', 'prisma', 'package.json'),
    );
    assert.equal(
        resolvePackageBin(app, 'prisma', 'prisma'),
        path.join(root, 'node_modules', 'prisma', 'build', 'index.js'),
    );
    assert.equal(resolvePackageBin(app, 'not-installed'), null);
});

test('helpers: missing prisma suggests the workspace install command', (t) => {
    const root = fixture(t);
    const app = path.join(root, 'apps', 'api');
    fs.mkdirSync(app, { recursive: true });

    assert.throws(
        () =>
            ensureLocalPrisma({
                projectRoot: app,
                workspaceRoot: root,
                packageName: '@repo/api',
                isWorkspaceMember: true,
                pm: PACKAGE_MANAGERS.pnpm,
                prismaVersion: '7.10.0',
            }),
        (err) =>
            err.name === 'CliError' &&
            /pnpm --filter @repo\/api add -D prisma@7\.10\.0/.test(err.hints.join(' ')),
    );
});

test('helpers: Yarn PnP fails with an explicit message', (t) => {
    const root = fixture(t);
    const app = path.join(root, 'apps', 'api');
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(root, '.pnp.cjs'), 'module.exports = {};\n');

    assert.throws(
        () =>
            ensureLocalPrisma({
                projectRoot: app,
                workspaceRoot: root,
                packageName: '@repo/api',
                isWorkspaceMember: true,
                pm: PACKAGE_MANAGERS.yarn,
                prismaVersion: '7.10.0',
            }),
        (err) => err.name === 'CliError' && /Yarn PnP/.test(err.message),
    );
});

test('installDeps: Yarn PnP fails during planning, before files change', (t) => {
    const root = fixture(t);
    const app = path.join(root, 'apps', 'api');
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(root, '.pnp.cjs'), 'module.exports = {};\n');

    assert.throws(
        () =>
            installStep.plan({
                install: true,
                dependencies: [],
                devDependencies: [],
                pkgJson: { dependencies: {}, devDependencies: {} },
                projectRoot: app,
                workspaceRoot: root,
                packageName: '@repo/api',
                isWorkspaceMember: true,
                pm: PACKAGE_MANAGERS.yarn,
            }),
        (err) => err.name === 'CliError' && /Yarn PnP/.test(err.message),
    );
});

test('runner: workspace metadata reaches the context', () => {
    const base = {
        projectRoot: path.resolve('/repo/apps/api'),
        pkgJson: {},
        answers: { prismaVersion: '7.10.0', database: 'postgres', runGenerate: false },
        packageManager: { name: 'pnpm', source: 'package.json packageManager' },
        install: false,
    };

    const ctx = buildContext({
        ...base,
        workspace: {
            workspaceRoot: path.resolve('/repo'),
            appDir: path.resolve('/repo/apps/api'),
            packageName: '@repo/api',
            appRel: 'apps/api',
            isWorkspace: true,
            isMember: true,
            turbo: true,
        },
    });

    assert.equal(ctx.workspaceRoot, path.resolve('/repo'));
    assert.equal(ctx.packageName, '@repo/api');
    assert.equal(ctx.appRel, 'apps/api');
    assert.equal(ctx.isWorkspaceMember, true);
    assert.equal(ctx.turbo, true);

    const single = buildContext({ ...base, projectRoot: path.resolve('/single') });
    assert.equal(single.workspaceRoot, null);
    assert.equal(single.isWorkspaceMember, false);
    assert.equal(single.turbo, false);
});

test('runner: Turbo hints appear in the summary of a workspace member', () => {
    const ctx = buildContext({
        projectRoot: path.resolve('/repo/apps/api'),
        pkgJson: {},
        answers: { prismaVersion: '7.10.0', database: 'postgres', runGenerate: true },
        packageManager: { name: 'pnpm', source: 'package.json packageManager' },
        install: false,
        workspace: {
            workspaceRoot: path.resolve('/repo'),
            appDir: path.resolve('/repo/apps/api'),
            packageName: '@repo/api',
            appRel: 'apps/api',
            isWorkspace: true,
            isMember: true,
            turbo: true,
        },
    });

    const chunks = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk) => {
        chunks.push(String(chunk));
        return true;
    };
    try {
        printSummary(ctx, { files: [], warnings: [], ran: 0 });
    } finally {
        process.stdout.write = originalWrite;
    }

    const out = chunks.join('');
    assert.match(out, /Turbo checklist/);
    assert.match(out, /generated\/prisma/);
    assert.match(out, /turbo run build --filter @repo\/api/);
    assert.match(out, /turbo\.json was not modified/);
});
