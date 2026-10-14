const path = require('path');

const fsHelpers = require('../utils/fsHelpers');
const ui = require('../ui/output');

/**
 * The prisma-client generator emits relative imports with a `.js` suffix
 * (`./internal/class.js`) next to `.ts` sources. ts-jest resolves modules like
 * Node, so without this mapping the first spec that imports the client fails
 * with "Cannot find module './internal/class.js'".
 */
const JS_SUFFIX_KEY = '^(\\.{1,2}/.*)\\.js$';
const JS_SUFFIX_VALUE = '$1';

const E2E_CONFIG = path.join('test', 'jest-e2e.json');

/** Returns the patched config object, or null when nothing has to change. */
function withMapper(config) {
    if (!config || typeof config !== 'object') return null;
    const mapper = config.moduleNameMapper || {};
    if (mapper[JS_SUFFIX_KEY] === JS_SUFFIX_VALUE) return null;
    return { ...config, moduleNameMapper: { ...mapper, [JS_SUFFIX_KEY]: JS_SUFFIX_VALUE } };
}

async function readJson(file) {
    try {
        return JSON.parse(await fsHelpers.readFile(file));
    } catch {
        return null;
    }
}

/** Jest configs this step can safely edit: package.json "jest" and test/jest-e2e.json. */
async function targets(ctx) {
    const found = [];
    const pkg = await readJson(ctx.paths.pkgJsonPath);
    if (pkg && pkg.jest) found.push({ file: ctx.paths.pkgJsonPath, label: 'package.json (jest)', kind: 'pkg', json: pkg });
    const e2e = path.join(ctx.projectRoot, E2E_CONFIG);
    if (await fsHelpers.exists(e2e)) {
        const json = await readJson(e2e);
        found.push({ file: e2e, label: 'test/jest-e2e.json', kind: 'json', json });
    }
    return found;
}

function needsChange(t) {
    if (!t.json) return false;
    return withMapper(t.kind === 'pkg' ? t.json.jest : t.json) !== null;
}

async function hasOtherJestConfig(ctx) {
    for (const name of ['jest.config.ts', 'jest.config.js', 'jest.config.cjs', 'jest.config.mjs', 'jest.config.json']) {
        if (await fsHelpers.exists(path.join(ctx.projectRoot, name))) return name;
    }
    return null;
}

module.exports = {
    id: 'jest',
    title: 'Map .js imports of the generated client for Jest',

    async plan(ctx) {
        const found = await targets(ctx);
        const entries = [];
        for (const t of found) {
            if (!t.json) {
                entries.push({ kind: 'warn', label: t.label, reason: 'not plain JSON, add the moduleNameMapper manually' });
            } else if (needsChange(t)) {
                entries.push({ kind: 'modify', label: `${t.label} (moduleNameMapper for .js imports)` });
            } else {
                entries.push({ kind: 'skip', label: t.label, reason: 'moduleNameMapper already set' });
            }
        }
        if (!found.length) {
            const other = await hasOtherJestConfig(ctx);
            entries.push(
                other
                    ? { kind: 'warn', label: other, reason: `add "moduleNameMapper": { "${JS_SUFFIX_KEY}": "${JS_SUFFIX_VALUE}" } manually` }
                    : { kind: 'skip', label: 'jest config', reason: 'no Jest config found' },
            );
        }
        return { entries };
    },

    async run(ctx) {
        const files = [];
        for (const t of await targets(ctx)) {
            if (!t.json) {
                ui.warn(`${t.label} is not plain JSON. Add this to its moduleNameMapper:`);
                ui.code(`"${JS_SUFFIX_KEY}": "${JS_SUFFIX_VALUE}"`);
                continue;
            }
            if (!needsChange(t)) continue;
            const next = t.kind === 'pkg' ? { ...t.json, jest: withMapper(t.json.jest) } : withMapper(t.json);
            await fsHelpers.writeFile(t.file, `${JSON.stringify(next, null, 2)}\n`);
            ui.success(`Added the .js moduleNameMapper to ${t.label}`);
            files.push({ kind: 'modify', path: t.kind === 'pkg' ? 'package.json' : E2E_CONFIG.split(path.sep).join('/') });
        }
        const other = await hasOtherJestConfig(ctx);
        if (!files.length && other) {
            ui.warn(`Add this to the moduleNameMapper in ${other}:`);
            ui.code(`"${JS_SUFFIX_KEY}": "${JS_SUFFIX_VALUE}"`);
            return { status: 'warning' };
        }
        return files.length ? { files } : { status: 'skipped' };
    },
};

module.exports.withMapper = withMapper;
module.exports.JS_SUFFIX_KEY = JS_SUFFIX_KEY;
