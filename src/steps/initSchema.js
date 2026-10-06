const path = require('path');

const fsHelpers = require('../utils/fsHelpers');
const ui = require('../ui/output');
const { rel, displayExec, runPrisma } = require('./helpers');

// Default: the client is generated INSIDE src/ on purpose. If it lived at the
// project root, TypeScript would widen rootDir and Nest would emit
// dist/src/main.js instead of dist/main.js, which breaks `npm run start:prod`.
// Users can opt into the root layout with --output root; the prod-entry step
// then compensates by repointing start:prod and nest-cli entryFile.
const CLIENT_OUTPUT = '../src/generated/prisma';

function generatorBlock(clientOutRel) {
    return [
        'generator client {',
        '  provider     = "prisma-client"',
        `  output       = "${clientOutRel}"`,
        '  moduleFormat = "cjs"',
        '}',
    ].join('\n');
}

function initArgs(ctx) {
    return [
        'init',
        '--datasource-provider',
        ctx.database.datasourceProvider,
        '--output',
        ctx.clientOutRel,
        // Don't drop .agents/.claude/.windsurf skill folders into the project.
        '--no-skills',
    ];
}

/** Forces the generator block into the shape the generated PrismaService expects. */
function patchSchema(source, clientOutRel = CLIENT_OUTPUT) {
    let patched = source.replace(/generator\s+client\s*\{[^}]*\}/, generatorBlock(clientOutRel));
    // Older templates put the URL in the schema; Prisma 7 reads it from the config file.
    patched = patched.replace(
        /^\s*url\s*=\s*env\("DATABASE_URL"\)\s*$/m,
        '  // The connection URL is read from DATABASE_URL by the driver adapter.',
    );
    return patched;
}

/** Extracts the generator `output` from an existing schema, if any. */
async function currentOutput(ctx) {
    if (!(await fsHelpers.exists(ctx.paths.schema))) return null;
    const source = await fsHelpers.readFile(ctx.paths.schema);
    const generator = source.match(/generator\s+client\s*\{([^}]*)\}/);
    if (!generator) return null;
    const provider = (generator[1].match(/provider\s*=\s*"([^"]+)"/) || [])[1];
    if (provider && provider !== 'prisma-client') return null;
    return (generator[1].match(/output\s*=\s*"([^"]+)"/) || [])[1] || null;
}

module.exports = {
    id: 'schema',
    title: 'Initialise the Prisma schema',

    async plan(ctx) {
        if (await fsHelpers.exists(ctx.paths.schema)) {
            const existing = await currentOutput(ctx);
            if (existing === null) {
                return {
                    entries: [{ kind: 'skip', label: 'prisma/schema.prisma', reason: 'exists with a non-prisma-client generator, left untouched' }],
                };
            }
            if (existing === ctx.clientOutRel) {
                return {
                    entries: [{ kind: 'skip', label: rel(ctx, ctx.paths.schema), reason: 'generator output already matches' }],
                };
            }
            return {
                entries: [{ kind: 'modify', label: `${rel(ctx, ctx.paths.schema)} (generator output -> ${ctx.clientOutRel})` }],
                data: { kind: 'switch', oldOutput: existing },
            };
        }
        return {
            entries: [
                { kind: 'run', label: displayExec(ctx, 'prisma', initArgs(ctx)) },
                { kind: 'create', label: `${rel(ctx, ctx.paths.schema)} (generator set for the driver adapter)` },
            ],
        };
    },

    async run(ctx, data) {
        // Re-run with an existing schema: only align the generator output.
        if (data && data.kind === 'switch') {
            const original = await fsHelpers.readFile(ctx.paths.schema);
            const patched = patchSchema(original, ctx.clientOutRel);
            if (patched !== original) {
                await fsHelpers.writeFile(ctx.paths.schema, patched);
                ui.success(`Aligned ${rel(ctx, ctx.paths.schema)} generator output to ${ctx.clientOutRel}`);
                if (data.oldOutput) {
                    // The schema `output` is relative to prisma/, not the project root.
                    const staleDir = path.resolve(ctx.paths.prismaDir, data.oldOutput);
                    if (await fsHelpers.exists(staleDir)) {
                        ui.warn(`A previously generated client still exists at ${rel(ctx, staleDir)} — delete it to avoid confusion.`);
                    }
                }
                return { files: [{ kind: 'modify', path: rel(ctx, ctx.paths.schema) }] };
            }
            ui.skip('Schema already matches the requested output');
            return { status: 'skipped' };
        }

        await runPrisma(ctx, initArgs(ctx));

        if (!(await fsHelpers.exists(ctx.paths.schema))) {
            ui.warn('"prisma init" did not create prisma/schema.prisma. Check the output above.');
            return { status: 'warning' };
        }

        const original = await fsHelpers.readFile(ctx.paths.schema);
        const patched = patchSchema(original, ctx.clientOutRel);
        if (patched !== original) {
            await fsHelpers.writeFile(ctx.paths.schema, patched);
        }

        ui.success(`Created ${rel(ctx, ctx.paths.schema)} for ${ctx.database.label}`);
        return { files: [{ kind: 'create', path: rel(ctx, ctx.paths.schema) }] };
    },
};

module.exports.patchSchema = patchSchema;
module.exports.CLIENT_OUTPUT = CLIENT_OUTPUT;
