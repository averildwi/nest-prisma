const { run, formatCommand } = require('../utils/exec');
const ui = require('../ui/output');

/** Splits "name@version" while respecting scoped names like "@prisma/client@7". */
function parseSpec(spec) {
    const at = spec.lastIndexOf('@');
    if (at > 0) return { name: spec.slice(0, at), version: spec.slice(at + 1) };
    return { name: spec, version: undefined };
}

/** True when package.json already declares a compatible version of the spec. */
function isSatisfied(spec, pkgJson, field) {
    const { name, version } = parseSpec(spec);
    const declared = (pkgJson[field] || {})[name];
    if (!declared) return false;
    if (!version) return true;
    return declared.replace(/^[\^~=v]+/, '') === version;
}

module.exports = {
    id: 'install',
    title: 'Install dependencies',

    plan(ctx) {
        if (!ctx.install) {
            return { entries: [{ kind: 'skip', label: 'Install dependencies', reason: '--no-install' }] };
        }

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
        if (devDeps.length) entries.push({ kind: 'run', label: formatCommand(ctx.pm.name, ctx.pm.addDev(devDeps)) });
        return { entries, data: { deps, devDeps, misplaced } };
    },

    async run(ctx, { deps, devDeps, misplaced }) {
        if (deps.length) await run(ctx.pm.name, addArgs(ctx, deps, misplaced), { cwd: ctx.projectRoot });
        if (devDeps.length) await run(ctx.pm.name, ctx.pm.addDev(devDeps), { cwd: ctx.projectRoot });

        const installed = [...deps, ...devDeps].map((s) => parseSpec(s).name);
        ui.success(`Installed ${installed.join(', ')}`);
        return { files: [{ kind: 'modify', path: 'package.json' }] };
    },
};

function addArgs(ctx, deps, misplaced) {
    const args = ctx.pm.add(deps);
    return misplaced.length && ctx.pm.prodFlag ? [...args, ctx.pm.prodFlag] : args;
}

module.exports.parseSpec = parseSpec;
module.exports.isSatisfied = isSatisfied;
