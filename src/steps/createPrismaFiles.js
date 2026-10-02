const path = require('path');

const { CliError } = require('../errors');
const fsHelpers = require('../utils/fsHelpers');
const ui = require('../ui/output');
const { rel } = require('./helpers');

function renderService(template, database) {
    const content = template
        .replaceAll('__ADAPTER_PACKAGE__', database.adapterPackage)
        .replaceAll('__ADAPTER_CLASS__', database.adapterClass);

    if (content.includes('__ADAPTER_')) {
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
        const template = await fsHelpers.readFile(path.join(ctx.templatesDir, 'prisma.service.ts'));

        await fsHelpers.ensureDir(path.dirname(serviceFile));
        await fsHelpers.writeFile(serviceFile, renderService(template, ctx.database));
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
