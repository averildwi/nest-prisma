const fsHelpers = require('../utils/fsHelpers');
const ui = require('../ui/output');
const { rel, displayExec, runPrisma } = require('./helpers');

// The client is generated INSIDE src/ on purpose. If it lived at the project
// root, TypeScript would widen rootDir and Nest would emit dist/src/main.js
// instead of dist/main.js, which breaks `npm run start:prod`.
const CLIENT_OUTPUT = '../src/generated/prisma';

const GENERATOR_BLOCK = [
    'generator client {',
    '  provider     = "prisma-client"',
    `  output       = "${CLIENT_OUTPUT}"`,
    '  moduleFormat = "cjs"',
    '}',
].join('\n');

function initArgs(ctx) {
    return [
        'init',
        '--datasource-provider',
        ctx.database.datasourceProvider,
        '--output',
        CLIENT_OUTPUT,
        // Don't drop .agents/.claude/.windsurf skill folders into the project.
        '--no-skills',
    ];
}

/** Forces the generator block into the shape the generated PrismaService expects. */
function patchSchema(source) {
    let patched = source.replace(/generator\s+client\s*\{[^}]*\}/, GENERATOR_BLOCK);
    // Older templates put the URL in the schema; Prisma 7 reads it from the config file.
    patched = patched.replace(
        /^\s*url\s*=\s*env\("DATABASE_URL"\)\s*$/m,
        '  // The connection URL is read from DATABASE_URL by the driver adapter.',
    );
    return patched;
}

module.exports = {
    id: 'schema',
    title: 'Initialise the Prisma schema',

    async plan(ctx) {
        if (await fsHelpers.exists(ctx.paths.prismaDir)) {
            return {
                entries: [{ kind: 'skip', label: 'prisma init', reason: 'prisma/ already exists, schema left untouched' }],
            };
        }
        return {
            entries: [
                { kind: 'run', label: displayExec(ctx, 'prisma', initArgs(ctx)) },
                { kind: 'create', label: `${rel(ctx, ctx.paths.schema)} (generator set for the driver adapter)` },
            ],
        };
    },

    async run(ctx) {
        await runPrisma(ctx, initArgs(ctx));

        if (!(await fsHelpers.exists(ctx.paths.schema))) {
            ui.warn('"prisma init" did not create prisma/schema.prisma. Check the output above.');
            return { status: 'warning' };
        }

        const original = await fsHelpers.readFile(ctx.paths.schema);
        const patched = patchSchema(original);
        if (patched !== original) {
            await fsHelpers.writeFile(ctx.paths.schema, patched);
        }

        ui.success(`Created ${rel(ctx, ctx.paths.schema)} for ${ctx.database.label}`);
        return { files: [{ kind: 'create', path: rel(ctx, ctx.paths.schema) }] };
    },
};

module.exports.patchSchema = patchSchema;
module.exports.CLIENT_OUTPUT = CLIENT_OUTPUT;
