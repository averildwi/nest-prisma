const { run, formatCommand } = require('../utils/exec');
const { assertNoPnp } = require('./helpers');
const ui = require('../ui/output');

/** Splits "name@version" while respecting scoped names like "@prisma/client@7". */
function parseSpec(spec) {
    const at = spec.lastIndexOf('@');
    if (at > 0) return { name: spec.slice(0, at), version: spec.slice(at + 1) };
    return { name: spec, version: undefined };
}

/**
 * Dependency specs that do not describe an npm semver range. A workspace
 * already owns these through pnpm/npm/yarn, so they count as declared.
 */
const PROTOCOL_PREFIXES = [
    'catalog:',
    'workspace:',
    'file:',
    'link:',
    'portal:',
    'git+',
    'git:',
    'github:',
    'https:',
    'http:',
    'npm:',
];

const ANY_VERSION = new Set(['*', 'x', 'X', 'latest']);

function isProtocolSpec(value) {
    return PROTOCOL_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function parseVersion(value) {
    const match = String(value)
        .trim()
        .match(/^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/i);
    if (!match) return null;

    const part = (raw) => {
        if (raw === undefined || /^[x*]$/i.test(raw)) return null;
        return Number(raw);
    };

    return { major: part(match[1]), minor: part(match[2]), patch: part(match[3]) };
}

function compareVersions(a, b) {
    for (const key of ['major', 'minor', 'patch']) {
        const left = a[key] ?? 0;
        const right = b[key] ?? 0;
        if (left !== right) return left < right ? -1 : 1;
    }
    return 0;
}

/** Minimal semver comparison for the exact versions this CLI installs. */
function satisfiesRange(declared, target) {
    const range = declared.trim();
    if (ANY_VERSION.has(range) || isProtocolSpec(range)) return true;
    if (range.includes('||')) {
        return range.split('||').some((part) => satisfiesRange(part, target));
    }

    const targetVersion = parseVersion(target);
    if (!targetVersion) return false;

    const match = range.match(/^(\^|~|>=|<=|>|<|=)?\s*(.+)$/);
    if (!match) return false;

    const operator = match[1] || '=';
    const rangeVersion = parseVersion(match[2]);
    if (!rangeVersion) return false;

    const delta = compareVersions(targetVersion, rangeVersion);
    switch (operator) {
        case '>=':
            return delta >= 0;
        case '>':
            return delta > 0;
        case '<=':
            return delta <= 0;
        case '<':
            return delta < 0;
        case '^':
            if (delta < 0) return false;
            if (rangeVersion.major > 0) return targetVersion.major === rangeVersion.major;
            if (rangeVersion.minor === null) return targetVersion.major === 0;
            if (rangeVersion.minor > 0) {
                return targetVersion.major === 0 && targetVersion.minor === rangeVersion.minor;
            }
            if (rangeVersion.patch === null) {
                return targetVersion.major === 0 && targetVersion.minor === 0;
            }
            return (
                targetVersion.major === 0 &&
                targetVersion.minor === 0 &&
                targetVersion.patch === rangeVersion.patch
            );
        case '~':
            if (delta < 0 || targetVersion.major !== rangeVersion.major) return false;
            return rangeVersion.minor === null || targetVersion.minor === rangeVersion.minor;
        default:
            if (rangeVersion.major !== targetVersion.major) return false;
            if (rangeVersion.minor !== null && rangeVersion.minor !== targetVersion.minor) return false;
            if (rangeVersion.patch !== null && rangeVersion.patch !== targetVersion.patch) return false;
            return true;
    }
}

/** True when package.json already declares a compatible version of the spec. */
function isSatisfied(spec, pkgJson, field) {
    const { name, version } = parseSpec(spec);
    const declared = (pkgJson[field] || {})[name];
    if (!declared) return false;
    if (!version) return true;
    return satisfiesRange(String(declared), version);
}

/** Workspace installs go through the PM's member-aware command. */
function isWorkspaceTarget(ctx) {
    return Boolean(ctx.workspaceRoot && ctx.packageName && ctx.isWorkspaceMember && ctx.pm.workspaceAdd);
}

function addArgs(ctx, deps, misplaced) {
    const args = isWorkspaceTarget(ctx)
        ? ctx.pm.workspaceAdd(ctx.packageName, deps)
        : ctx.pm.add(deps);
    return misplaced.length && ctx.pm.prodFlag ? [...args, ctx.pm.prodFlag] : args;
}

function devArgs(ctx, devDeps) {
    return isWorkspaceTarget(ctx)
        ? ctx.pm.workspaceAddDev(ctx.packageName, devDeps)
        : ctx.pm.addDev(devDeps);
}

/** npm/pnpm/yarn run at the workspace root; bun runs in the app directory. */
function installCwd(ctx) {
    if (isWorkspaceTarget(ctx) && ctx.pm.workspaceCwd === 'root') return ctx.workspaceRoot;
    return ctx.projectRoot;
}

module.exports = {
    id: 'install',
    title: 'Install dependencies',

    plan(ctx) {
        if (!ctx.install) {
            return { entries: [{ kind: 'skip', label: 'Install dependencies', reason: '--no-install' }] };
        }

        // Fail before package.json is touched: PnP has no node_modules for the
        // Prisma CLI that the later steps need.
        assertNoPnp(ctx);

        const deps = ctx.dependencies.filter((s) => !isSatisfied(s, ctx.pkgJson, 'dependencies'));
        const devDeps = ctx.devDependencies.filter((s) => !isSatisfied(s, ctx.pkgJson, 'devDependencies'));

        if (deps.length === 0 && devDeps.length === 0) {
            return { entries: [{ kind: 'skip', label: 'Install dependencies', reason: 'already installed' }] };
        }

        // npm keeps an existing devDependency in devDependencies even when
        // installed without --save-dev, so a runtime dep that sits there must
        // be moved explicitly with --save-prod.
        const misplaced = deps.filter((s) => isSatisfied(parseSpec(s).name, ctx.pkgJson, 'devDependencies'));

        const entries = [];
        if (deps.length) entries.push({ kind: 'run', label: formatCommand(ctx.pm.name, addArgs(ctx, deps, misplaced)) });
        if (devDeps.length) entries.push({ kind: 'run', label: formatCommand(ctx.pm.name, devArgs(ctx, devDeps)) });
        return { entries, data: { deps, devDeps, misplaced } };
    },

    async run(ctx, { deps, devDeps, misplaced }) {
        const cwd = installCwd(ctx);
        if (deps.length) await run(ctx.pm.name, addArgs(ctx, deps, misplaced), { cwd });
        if (devDeps.length) await run(ctx.pm.name, devArgs(ctx, devDeps), { cwd });

        const installed = [...deps, ...devDeps].map((s) => parseSpec(s).name);
        ui.success(`Installed ${installed.join(', ')}`);
        return { files: [{ kind: 'modify', path: 'package.json' }] };
    },
};

module.exports.parseSpec = parseSpec;
module.exports.isSatisfied = isSatisfied;
module.exports.satisfiesRange = satisfiesRange;
module.exports.addArgs = addArgs;
module.exports.devArgs = devArgs;
module.exports.installCwd = installCwd;
module.exports.isWorkspaceTarget = isWorkspaceTarget;
