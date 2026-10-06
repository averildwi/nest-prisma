const path = require('path');

const { CliError } = require('../errors');
const fsHelpers = require('../utils/fsHelpers');
const ui = require('../ui/output');
const { rel } = require('./helpers');

// Matches the import the template (and every earlier release) emitted, so an
// existing service can be re-pointed when the user switches client output.
const CLIENT_IMPORT_REGEX = /import \{ PrismaClient \} from '([^']+)';/;

function renderService(template, database, clientImport) {
    const content = template
        .replaceAll('__ADAPTER_PACKAGE__', database.adapterPackage)
        .replaceAll('__ADAPTER_CLASS__', database.adapterClass)
        .replaceAll('__CLIENT_IMPORT__', clientImport);

    if (content.includes('__ADAPTER_') || content.includes('__CLIENT_IMPORT__')) {
        throw new CliError('The PrismaService template has unresolved placeholders.', {
            hints: ['This is a bug in @averildwi/nest-prisma. Please report it.'],
        });
    }
    return content;
}

module.exports = {
    id: 'files',
    title: 'Create PrismaService and PrismaModule',

    async plan(ctx) {
        const { serviceFile, moduleFile } = ctx.paths;
        const existing = [];
        if (await fsHelpers.exists(serviceFile)) existing.push(rel(ctx, serviceFile));
        if (await fsHelpers.exists(moduleFile)) existing.push(rel(ctx, moduleFile));

        if (existing.length) {
            // Re-point an existing service when the requested client location
            // differs from what it currently imports.
            if (await fsHelpers.exists(serviceFile)) {
                const source = await fsHelpers.readFile(serviceFile);
                const match = source.match(CLIENT_IMPORT_REGEX);
                if (match && match[1] !== ctx.serviceImport) {
                    return {
                        entries: [{ kind: 'modify', label: `${rel(ctx, serviceFile)} (client import -> ${ctx.serviceImport})` }],
                    };
                }
            }
            return {
                entries: [{ kind: 'skip', label: 'src/prisma/*', reason: `${existing.join(', ')} already exists` }],
            };
        }
        return {
            entries: [
                { kind: 'create', label: rel(ctx, serviceFile) },
                { kind: 'create', label: rel(ctx, moduleFile) },
            ],
        };
    },

    async run(ctx) {
        const { serviceFile, moduleFile } = ctx.paths;

        if (await fsHelpers.exists(serviceFile)) {
            const source = await fsHelpers.readFile(serviceFile);
            const match = source.match(CLIENT_IMPORT_REGEX);
            if (match && match[1] !== ctx.serviceImport) {
                await fsHelpers.writeFile(
                    serviceFile,
                    source.replace(CLIENT_IMPORT_REGEX, `import { PrismaClient } from '${ctx.serviceImport}';`),
                );
                ui.success(`Updated ${rel(ctx, serviceFile)} to import from ${ctx.serviceImport}`);
                return { files: [{ kind: 'modify', path: rel(ctx, serviceFile) }] };
            }
            ui.skip('PrismaService already imports the right client path');
            return { status: 'skipped' };
        }

        const template = await fsHelpers.readFile(path.join(ctx.templatesDir, 'prisma.service.ts'));

        await fsHelpers.ensureDir(path.dirname(serviceFile));
        await fsHelpers.writeFile(serviceFile, renderService(template, ctx.database, ctx.serviceImport));
        await fsHelpers.copy(path.join(ctx.templatesDir, 'prisma.module.ts'), moduleFile);

        ui.success(`Created ${rel(ctx, serviceFile)} using ${ctx.database.adapterClass}`);
        ui.success(`Created ${rel(ctx, moduleFile)}`);
        return {
            files: [
                { kind: 'create', path: rel(ctx, serviceFile) },
                { kind: 'create', path: rel(ctx, moduleFile) },
            ],
        };
    },
};

module.exports.renderService = renderService;
