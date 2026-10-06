const path = require('path');

const fsHelpers = require('../utils/fsHelpers');
const ui = require('../ui/output');
const { rel } = require('./helpers');

const PROD_SCRIPT = 'start:prod';
const NARROW_ENTRY = 'node dist/main';
const WIDENED_ENTRY = 'node dist/src/main';
const NEST_ENTRY_DEFAULT = 'main';
const NEST_ENTRY_WIDENED = 'src/main';

/**
 * Keeps the prod entry aligned with the build layout.
 *
 * A client at the project root widens the tsc rootDir, so the build emits
 * dist/src/main.js instead of dist/main.js; "start:prod" and the nest-cli
 * entryFile must point one level deeper. A client inside src restores the
 * narrow layout, and the entries are reverted back (only when they still
 * carry the exact values this CLI wrote).
 */
module.exports = {
    id: 'prod-entry',
    title: 'Align start:prod and nest-cli with the build output',

    async plan(ctx) {
        const entries = [];
        const rootMode = ctx.clientOutput === 'root';

        const prod = await readProdScript(ctx);
        if (rootMode) {
            if (prod === null) {
                entries.push({
                    kind: 'warn',
                    label: 'package.json',
                    reason: `no "${PROD_SCRIPT}" script found; set it to "${WIDENED_ENTRY}" manually`,
                });
            } else if (prod === WIDENED_ENTRY) {
                entries.push({ kind: 'skip', label: 'package.json', reason: 'start:prod already points at dist/src/main' });
            } else {
                entries.push({ kind: 'modify', label: `package.json (start:prod: ${prod} -> ${WIDENED_ENTRY})` });
            }

            const entry = await readNestEntry(ctx);
            if (entry === NEST_ENTRY_WIDENED) {
                entries.push({ kind: 'skip', label: 'nest-cli.json', reason: 'entryFile already set' });
            } else {
                entries.push({ kind: 'modify', label: 'nest-cli.json (entryFile -> src/main, so "nest start/build" finds dist/src/main.js)' });
            }
        } else {
            if (prod === WIDENED_ENTRY) {
                entries.push({ kind: 'modify', label: `package.json (start:prod: ${WIDENED_ENTRY} -> ${NARROW_ENTRY})` });
            } else {
                entries.push({ kind: 'skip', label: 'package.json', reason: 'start:prod already matches the build layout' });
            }

            const entry = await readNestEntry(ctx);
            if (entry === NEST_ENTRY_WIDENED) {
                entries.push({ kind: 'modify', label: 'nest-cli.json (entryFile -> main)' });
            } else {
                entries.push({ kind: 'skip', label: 'nest-cli.json', reason: 'entryFile already matches the build layout' });
            }
        }

        return { entries };
    },

    async run(ctx) {
        const changed = [];
        const rootMode = ctx.clientOutput === 'root';

        const prod = await readProdScript(ctx);
        if (rootMode && typeof prod === 'string' && prod !== WIDENED_ENTRY) {
            await writeProdScript(ctx, WIDENED_ENTRY);
            ui.success(`${PROD_SCRIPT} -> ${WIDENED_ENTRY}`);
            changed.push({ kind: 'modify', path: 'package.json' });
        } else if (!rootMode && prod === WIDENED_ENTRY) {
            await writeProdScript(ctx, NARROW_ENTRY);
            ui.success(`${PROD_SCRIPT} -> ${NARROW_ENTRY}`);
            changed.push({ kind: 'modify', path: 'package.json' });
        }

        const entry = await readNestEntry(ctx);
        if (rootMode && entry !== NEST_ENTRY_WIDENED) {
            await writeNestEntry(ctx, NEST_ENTRY_WIDENED);
            ui.success('nest-cli.json entryFile -> src/main');
            changed.push({ kind: 'modify', path: 'nest-cli.json' });
        } else if (!rootMode && entry === NEST_ENTRY_WIDENED) {
            await writeNestEntry(ctx, NEST_ENTRY_DEFAULT);
            ui.success('nest-cli.json entryFile -> main');
            changed.push({ kind: 'modify', path: 'nest-cli.json' });
        }

        if (!changed.length) {
            ui.skip('Prod entry already matches the build layout');
            return { status: 'skipped' };
        }
        return { files: changed };
    },
};

async function readProdScript(ctx) {
    const pkgJson = await readJson(ctx.paths.pkgJsonPath);
    const value = pkgJson && pkgJson.scripts && pkgJson.scripts[PROD_SCRIPT];
    return typeof value === 'string' ? value : null;
}

async function writeProdScript(ctx, value) {
    const pkgJson = await readJson(ctx.paths.pkgJsonPath);
    if (!pkgJson || !pkgJson.scripts) return;
    pkgJson.scripts[PROD_SCRIPT] = value;
    await fsHelpers.writeFile(ctx.paths.pkgJsonPath, `${JSON.stringify(pkgJson, null, 2)}\n`);
}

async function readNestEntry(ctx) {
    const nestCli = await readJson(ctx.paths.nestCliJson);
    return (nestCli && nestCli.compilerOptions && nestCli.compilerOptions.entryFile) || null;
}

async function writeNestEntry(ctx, value) {
    const nestCli = await readJson(ctx.paths.nestCliJson);
    if (!nestCli) return;
    if (!nestCli.compilerOptions) nestCli.compilerOptions = {};
    nestCli.compilerOptions.entryFile = value;
    await fsHelpers.writeFile(ctx.paths.nestCliJson, `${JSON.stringify(nestCli, null, 2)}\n`);
}

async function readJson(filePath) {
    try {
        return JSON.parse(await fsHelpers.readFile(filePath));
    } catch {
        return null;
    }
}
