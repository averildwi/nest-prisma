const fs = require('fs');
const path = require('path');

const { CliError } = require('../errors');
const { run, formatCommand } = require('../utils/exec');

/** Display a path relative to the project root with forward slashes. */
function rel(ctx, absolutePath) {
    return path.relative(ctx.projectRoot, absolutePath).split(path.sep).join('/');
}

/** Builds the command used to invoke a project-local binary (e.g. prisma). */
function execCommand(ctx, bin, args) {
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
 */
function ensureLocalPrisma(ctx) {
    const local = path.join(ctx.projectRoot, 'node_modules', 'prisma', 'package.json');
    if (fs.existsSync(local)) return;

    throw new CliError('The Prisma CLI is not installed in this project.', {
        hints: [
            `Install it with: ${formatCommand(ctx.pm.name, ctx.pm.addDev([`prisma@${ctx.prismaVersion}`]))}`,
            'Or re-run without --no-install.',
        ],
    });
}

async function runPrisma(ctx, args) {
    ensureLocalPrisma(ctx);
    const { command, args: finalArgs } = execCommand(ctx, 'prisma', args);
    await run(command, finalArgs, { cwd: ctx.projectRoot });
}

module.exports = { rel, displayExec, ensureLocalPrisma, runPrisma };
