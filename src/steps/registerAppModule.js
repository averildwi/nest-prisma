const fsHelpers = require('../utils/fsHelpers');
const ui = require('../ui/output');
const { rel } = require('./helpers');

const IMPORT_LINE = "import { PrismaModule } from './prisma/prisma.module';";
const IMPORTS_ARRAY = /imports\s*:\s*\[/;

/**
 * Inserts the import after the last top-level import so it never lands above a
 * license header, a shebang or a "use strict" pragma.
 */
function insertImport(source) {
    // Match the statement only (no trailing whitespace) so we control newlines.
    const importRegex = /^import\s[^;]*;/gm;
    let lastMatchEnd = -1;
    let match;
    while ((match = importRegex.exec(source)) !== null) {
        lastMatchEnd = match.index + match[0].length;
    }
    if (lastMatchEnd === -1) return `${IMPORT_LINE}\n${source}`;
    return `${source.slice(0, lastMatchEnd)}\n${IMPORT_LINE}${source.slice(lastMatchEnd)}`;
}

/**
 * Adds PrismaModule as the first entry of `imports: [...]`, keeping the style:
 *   imports: []              ->  imports: [PrismaModule]
 *   imports: [UsersModule]   ->  imports: [PrismaModule, UsersModule]
 *   imports: [\n    X,\n  ]  ->  imports: [\n    PrismaModule,\n    X,\n  ]
 */
function injectIntoImportsArray(source) {
    return source.replace(/imports\s*:\s*\[[ \t]*(\r?\n)?/, (match, newline, offset) => {
        const after = source.slice(offset + match.length);
        if (newline) {
            const indent = (after.match(/^[ \t]+/) || ['    '])[0];
            return `${match}${indent}PrismaModule,${newline}`;
        }
        return after.startsWith(']') ? `${match}PrismaModule` : `${match}PrismaModule, `;
    });
}

function register(source) {
    return injectIntoImportsArray(insertImport(source));
}

module.exports = {
    id: 'register',
    title: 'Register PrismaModule in AppModule',

    async plan(ctx) {
        const file = rel(ctx, ctx.paths.appModule);

        if (!(await fsHelpers.exists(ctx.paths.appModule))) {
            return { entries: [{ kind: 'skip', label: file, reason: 'file not found, import PrismaModule manually' }] };
        }
        const source = await fsHelpers.readFile(ctx.paths.appModule);
        if (source.includes('PrismaModule')) {
            return { entries: [{ kind: 'skip', label: file, reason: 'PrismaModule already registered' }] };
        }
        if (!IMPORTS_ARRAY.test(source)) {
            return {
                entries: [{ kind: 'warn', label: file, reason: 'no "imports: [" array found, needs a manual edit' }],
                data: { manual: true },
            };
        }
        return { entries: [{ kind: 'modify', label: `${file} (add PrismaModule to imports)` }], data: { manual: false } };
    },

    async run(ctx, { manual }) {
        const file = rel(ctx, ctx.paths.appModule);

        if (manual) {
            ui.warn(`Could not find an "imports: [" array in ${file}. Add PrismaModule yourself:`);
            ui.code([IMPORT_LINE, '@Module({ imports: [PrismaModule] })']);
            return { status: 'warning' };
        }

        const source = await fsHelpers.readFile(ctx.paths.appModule);
        await fsHelpers.writeFile(ctx.paths.appModule, register(source));
        ui.success(`Registered PrismaModule in ${file}`);
        return { files: [{ kind: 'modify', path: file }] };
    },
};

module.exports.register = register;
module.exports.IMPORT_LINE = IMPORT_LINE;
