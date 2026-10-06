const path = require('path');

const fsHelpers = require('../utils/fsHelpers');
const ui = require('../ui/output');
const { displayExec, runPrisma } = require('./helpers');

module.exports = {
    id: 'generate',
    title: 'Generate Prisma Client',

    async plan(ctx) {
        if (!ctx.runGenerate) {
            return { entries: [{ kind: 'skip', label: 'prisma generate', reason: '--no-generate' }] };
        }
        // Skip on re-runs once the client exists, so a fully configured project
        // reports "nothing to do". After schema changes the user regenerates
        // as part of their normal workflow (migrate dev does it automatically).
        const clientEntry = path.join(ctx.clientDir, 'client.ts');
        if (await fsHelpers.exists(clientEntry)) {
            return { entries: [{ kind: 'skip', label: 'prisma generate', reason: 'client already generated' }] };
        }
        return { entries: [{ kind: 'run', label: displayExec(ctx, 'prisma', ['generate']) }] };
    },

    async run(ctx) {
        try {
            await runPrisma(ctx, ['generate']);
        } catch (err) {
            // Every file is already in place, so a failure here is recoverable
            // by re-running the command; report it instead of aborting.
            ui.warn('Prisma Client generation failed. Fix the error above, then run:');
            ui.code(displayExec(ctx, 'prisma', ['generate']));
            ctx.generateFailed = true;
            return { status: 'warning' };
        }
        ui.success(`Generated Prisma Client in ${ctx.clientOutRel.replace('../', '')}`);
        return {};
    },
};
