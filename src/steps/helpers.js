const fs = require('fs');
const path = require('path');

const { CliError } = require('../errors');
const { run, formatCommand } = require('../utils/exec');

/** Display a path relative to the project root with forward slashes. */
function rel(ctx, absolutePath) {
    return path.relative(ctx.projectRoot, absolutePath).split(path.sep).join('/');
}

/**
 * Walks up from `startDir` until it finds `node_modules/<packageName>`.
 * npm and pnpm hoist dependencies to the workspace root, so the package is not
 * always directly below the app.
 */
function findPackageFile(startDir, packageName) {
    let dir = path.resolve(startDir);
    while (true) {
        const candidate = path.join(dir, 'node_modules', packageName, 'package.json');
        if (fs.existsSync(candidate)) return candidate;

        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/** Resolves the JS entrypoint declared in a package's `bin` field. */
function resolvePackageBin(startDir, packageName, binName = packageName) {
    const pkgPath = findPackageFile(startDir, packageName);
    if (!pkgPath) return null;

    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch {
        return null;
    }

    let entry;
    if (typeof pkg.bin === 'string') {
        entry = pkg.bin;
    } else if (pkg.bin && typeof pkg.bin === 'object') {
        entry = pkg.bin[binName] || Object.values(pkg.bin)[0];
    }
    if (!entry) return null;

    const binPath = path.resolve(path.dirname(pkgPath), entry);
    return fs.existsSync(binPath) ? binPath : null;
}

function findUp(startDir, fileName) {
    let dir = path.resolve(startDir);
    while (true) {
        const candidate = path.join(dir, fileName);
        if (fs.existsSync(candidate)) return candidate;

        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/** Yarn PnP has no node_modules, so local bin resolution cannot work. */
function findPnpMarker(startDir) {
    return findUp(startDir, '.pnp.cjs') || findUp(startDir, '.pnp.js');
}

/**
 * Fails before any file is written when the project is a Yarn PnP workspace.
 * PnP intentionally has no node_modules, so the CLI cannot locate Prisma.
 */
function assertNoPnp(ctx) {
    if (resolvePackageBin(ctx.projectRoot, 'prisma', 'prisma')) return;

    const pnpMarker =
        findPnpMarker(ctx.projectRoot) || (ctx.workspaceRoot ? findPnpMarker(ctx.workspaceRoot) : null);
    if (!pnpMarker) return;

    throw new CliError('Yarn PnP projects are not supported yet.', {
        hints: [
            `Found ${pnpMarker}, but this CLI needs node_modules to locate the Prisma CLI.`,
            'Switch the project to nodeLinker: "node-modules", or run prisma manually after installing it.',
        ],
    });
}

/** Builds the command used to invoke a project-local binary (e.g. prisma). */
function execCommand(ctx, bin, args) {
    if (ctx.isWorkspaceMember && ctx.packageName && ctx.pm.workspaceExec) {
        return ctx.pm.workspaceExec(ctx.packageName, bin, args);
    }
    return ctx.pm.exec(bin, args);
}

function displayExec(ctx, bin, args) {
    const { command, args: finalArgs } = execCommand(ctx, bin, args);
    return formatCommand(command, finalArgs);
}

/**
 * Refuses to fall back to a remote download of the Prisma CLI. Without a local
 * install, `npx prisma` would fetch whatever `latest` is on npm — which today
 * is a Prisma 8 release candidate with a completely different CLI.
 *
 * Returns the resolved bin script so callers can run it with `node`.
 */
function ensureLocalPrisma(ctx) {
    const binPath = resolvePackageBin(ctx.projectRoot, 'prisma', 'prisma');
    if (binPath) return binPath;

    assertNoPnp(ctx);

    const packageSpec = `prisma@${ctx.prismaVersion}`;
    const installCommand =
        ctx.isWorkspaceMember && ctx.pm.workspaceAddDev
            ? formatCommand(ctx.pm.name, ctx.pm.workspaceAddDev(ctx.packageName, [packageSpec]))
            : formatCommand(ctx.pm.name, ctx.pm.addDev([packageSpec]));

    throw new CliError('The Prisma CLI is not installed in this project.', {
        hints: [`Install it with: ${installCommand}`, 'Or re-run without --no-install.'],
    });
}

async function runPrisma(ctx, args) {
    const binPath = ensureLocalPrisma(ctx);
    // Run the package's bin with node directly: this works with hoisted
    // workspace dependencies (npm/pnpm/yarn) and never downloads a remote CLI.
    await run(process.execPath, [binPath, ...args], { cwd: ctx.projectRoot });
}

module.exports = { rel, findPackageFile, resolvePackageBin, displayExec, assertNoPnp, ensureLocalPrisma, runPrisma };
