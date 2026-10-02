const path = require('path');

const fsHelpers = require('../utils/fsHelpers');
const ui = require('../ui/output');
const { rel } = require('./helpers');

/** Config files `prisma init` may create at the project root. */
const PRISMA_CONFIG_FILES = ['prisma.config.ts', 'prisma7.config.ts'];

/**
 * Keeps the Prisma config file out of the Nest build.
 *
 * `prisma init` writes a `.ts` config at the project root. tsconfig.json has no
 * "include", so tsc would compile that file too, widen rootDir to the project
 * root and emit dist/src/main.js instead of dist/main.js — which breaks
 * `npm run start:prod`.
 */
module.exports = {
    id: 'build',
    title: 'Keep the Prisma config out of the Nest build',

    async plan(ctx) {
        const file = rel(ctx, ctx.paths.tsconfigBuild);
        if (!(await fsHelpers.exists(ctx.paths.tsconfigBuild))) {
            return { entries: [{ kind: 'skip', label: file, reason: 'file not found' }] };
        }

        const config = await readJson(ctx.paths.tsconfigBuild);
        if (config === null) {
            return {
                entries: [{ kind: 'warn', label: file, reason: 'not plain JSON, needs a manual edit' }],
            };
        }

        const excluded = new Set(config.exclude || []);
        // prisma init may not have run yet, so consider every possible name
        // until a config file actually exists.
        const present = await presentConfigFiles(ctx);
        const relevant = present.length ? present : PRISMA_CONFIG_FILES;
        if (present.length && relevant.every((name) => excluded.has(name))) {
            return { entries: [{ kind: 'skip', label: file, reason: 'Prisma config already excluded' }] };
        }
        return { entries: [{ kind: 'modify', label: `${file} (exclude the Prisma config file)` }] };
    },

    async run(ctx) {
        const file = rel(ctx, ctx.paths.tsconfigBuild);
        const config = await readJson(ctx.paths.tsconfigBuild);

        if (config === null) {
            ui.warn(`${file} could not be parsed (it may contain comments). Add this to its "exclude" array:`);
            ui.code(PRISMA_CONFIG_FILES.map((name) => `"${name}"`).join(', '));
            return { status: 'warning' };
        }

        // Only exclude config files that actually exist, to avoid noise.
        const present = await presentConfigFiles(ctx);

        const exclude = Array.isArray(config.exclude) ? [...config.exclude] : [];
        const missing = present.filter((name) => !exclude.includes(name));

        if (missing.length === 0) {
            ui.skip('No Prisma config file needs excluding');
            return { status: 'skipped' };
        }

        config.exclude = [...exclude, ...missing];
        await fsHelpers.writeFile(ctx.paths.tsconfigBuild, `${JSON.stringify(config, null, 2)}\n`);
        ui.success(`Excluded ${missing.join(', ')} in ${file}`);
        return { files: [{ kind: 'modify', path: file }] };
    },
};

async function presentConfigFiles(ctx) {
    const present = [];
    for (const name of PRISMA_CONFIG_FILES) {
        if (await fsHelpers.exists(path.join(ctx.projectRoot, name))) present.push(name);
    }
    return present;
}

async function readJson(filePath) {
    try {
        return JSON.parse(await fsHelpers.readFile(filePath));
    } catch {
        return null;
    }
}
