/**
 * The ordered pipeline. Every step exposes:
 *   - plan(ctx)        -> { entries: PlanEntry[], data? }  (must not change anything)
 *   - run(ctx, data)   -> { status?, files? }
 *
 * A step whose entries are all `skip` is not executed, which is what makes
 * re-running the CLI on an already configured project safe.
 */
module.exports = [
    require('./installDeps'),
    require('./initSchema'),
    require('./createPrismaFiles'),
    require('./registerAppModule'),
    require('./updateGitignore'),
    require('./configureBuild'),
    require('./generateClient'),
];
