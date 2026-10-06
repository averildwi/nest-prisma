const path = require('path');

const ui = require('./ui/output');
const { colors: c } = require('./ui/colors');
const { CliError } = require('./errors');
const { getDatabase, getVersion, resolveDependencies } = require('./config/registry');
const { getPackageManager } = require('./utils/packageManager');
const { displayExec } = require('./steps/helpers');
const steps = require('./steps');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates', 'prisma');

function buildContext({ projectRoot, pkgJson, answers, packageManager, install }) {
    const database = getDatabase(answers.database);
    const { dependencies, devDependencies } = resolveDependencies({
        version: answers.prismaVersion,
        database: answers.database,
    });

    // Where the generated Prisma Client lives. "src" keeps the tsc rootDir
    // narrow so the build emits dist/main.js; "root" widens it and makes the
    // build emit dist/src/main.js, which the prod-entry step compensates for.
    const clientOutput = answers.clientOutput === 'root' ? 'root' : 'src';
    const clientOutRel = clientOutput === 'root' ? '../generated/prisma' : '../src/generated/prisma';
    const clientDir = path.join(
        projectRoot,
        clientOutput === 'root' ? 'generated/prisma' : 'src/generated/prisma',
    );

    return {
        projectRoot,
        pkgJson,
        database,
        prismaVersion: answers.prismaVersion,
        clientOutput,
        clientOutRel,
        clientDir,
        serviceImport:
            clientOutput === 'root' ? '../../generated/prisma/client' : '../generated/prisma/client',
        runGenerate: answers.runGenerate,
        install,
        pm: getPackageManager(packageManager.name),
        pmSource: packageManager.source,
        dependencies,
        devDependencies,
        templatesDir: TEMPLATES_DIR,
        paths: {
            prismaDir: path.join(projectRoot, 'prisma'),
            schema: path.join(projectRoot, 'prisma', 'schema.prisma'),
            serviceFile: path.join(projectRoot, 'src', 'prisma', 'prisma.service.ts'),
            moduleFile: path.join(projectRoot, 'src', 'prisma', 'prisma.module.ts'),
            appModule: path.join(projectRoot, 'src', 'app.module.ts'),
            gitignore: path.join(projectRoot, '.gitignore'),
            tsconfigBuild: path.join(projectRoot, 'tsconfig.build.json'),
            nestCliJson: path.join(projectRoot, 'nest-cli.json'),
            pkgJsonPath: path.join(projectRoot, 'package.json'),
            env: path.join(projectRoot, '.env'),
        },
    };
}

/** Asks every step what it would do. Never mutates the project. */
async function buildPlan(ctx) {
    const plan = [];
    for (const step of steps) {
        const { entries, data } = await step.plan(ctx);
        const actionable = entries.some((e) => e.kind !== 'skip');
        plan.push({ step, entries, data, actionable });
    }
    return plan;
}

const KIND_STYLE = {
    create: (t) => `${c.green('+')} ${t}`,
    modify: (t) => `${c.yellow('~')} ${t}`,
    run: (t) => `${c.cyan('$')} ${t}`,
    warn: (t) => `${c.yellow('!')} ${t}`,
    skip: (t) => `${c.gray('-')} ${c.gray(t)}`,
};

function printPlan(ctx, plan, { dryRun }) {
    ui.section('Configuration');
    ui.keyValues([
        ['Project', path.basename(ctx.projectRoot)],
        ['Database', `${ctx.database.label} ${c.gray(`(${ctx.database.adapterPackage})`)}`],
        ['Prisma', ctx.prismaVersion],
        ['Client output', ctx.clientOutput === 'root' ? 'generated/prisma (project root)' : 'src/generated/prisma'],
        ['Package manager', `${ctx.pm.name} ${c.gray(`(${ctx.pmSource})`)}`],
    ]);

    ui.section(dryRun ? 'Planned changes (dry run, nothing will be modified)' : 'Planned changes');
    for (const { entries } of plan) {
        for (const entry of entries) {
            const reason = entry.reason ? c.gray(` (${entry.reason})`) : '';
            ui.out(`    ${KIND_STYLE[entry.kind](entry.label)}${reason}`);
        }
    }
}

/**
 * Executes the actionable steps in order and returns a summary.
 * If a step throws, the error is annotated with what had already been changed
 * so the user knows exactly what state their project is in.
 */
async function executePlan(ctx, plan) {
    const actionable = plan.filter((p) => p.actionable);
    const files = [];
    const warnings = [];
    const completed = [];

    for (const [index, item] of actionable.entries()) {
        ui.step(index + 1, actionable.length, item.step.title);
        try {
            const result = (await item.step.run(ctx, item.data || {})) || {};
            if (result.files) files.push(...result.files);
            if (result.status === 'warning') warnings.push(item.step.title);
            completed.push(item.step.title);
        } catch (err) {
            const failure = err instanceof CliError ? err : new CliError(err.message || String(err), { cause: err });
            failure.hints = [
                ...failure.hints,
                ...(completed.length ? ['', `Completed before the failure: ${completed.join(', ')}.`] : []),
                ...(files.length ? [`Files already changed: ${unique(files.map((f) => f.path)).join(', ')}.`] : []),
                'It is safe to fix the problem and run the command again; finished steps will be skipped.',
            ];
            failure.failedStep = item.step.title;
            throw failure;
        }
    }

    return { files, warnings, ran: actionable.length };
}

function unique(list) {
    return [...new Set(list)];
}

function printSummary(ctx, summary) {
    const files = new Map();
    for (const f of summary.files) {
        // "create" wins over "modify" for the same path.
        if (!files.has(f.path) || f.kind === 'create') files.set(f.path, f.kind);
    }

    ui.out();
    if (summary.warnings.length) {
        ui.out(`  ${c.yellow(c.bold('Done, with warnings.'))} ${c.gray('Review the messages marked ⚠ above.')}`);
    } else {
        ui.out(`  ${c.green(c.bold('Prisma is ready.'))}`);
    }

    if (files.size) {
        ui.section('Changed files');
        for (const [file, kind] of files) {
            ui.out(`    ${KIND_STYLE[kind] ? KIND_STYLE[kind](file) : file}`);
        }
    }

    printNextSteps(ctx);
}

function printNextSteps(ctx) {
    const steps = [];
    steps.push([
        `Set ${c.bold('DATABASE_URL')} in ${c.bold('.env')}:`,
        `DATABASE_URL="${ctx.database.exampleUrl}"`,
    ]);
    steps.push([
        `Add your models to ${c.bold('prisma/schema.prisma')}, then create the tables:`,
        displayExec(ctx, 'prisma', ['migrate', 'dev', '--name', 'init']),
    ]);
    if (!ctx.runGenerate || ctx.generateFailed) {
        steps.push(['Generate the client:', displayExec(ctx, 'prisma', ['generate'])]);
    }
    steps.push([
        `Inject ${c.bold('PrismaService')} wherever you need it:`,
        'constructor(private readonly prisma: PrismaService) {}',
    ]);

    ui.section('Next steps');
    steps.forEach(([text, command], i) => {
        ui.out(`    ${c.cyan(`${i + 1}.`)} ${text}`);
        ui.out(`       ${c.cyan(command)}`);
    });
    ui.out();
}

module.exports = { buildContext, buildPlan, printPlan, executePlan, printSummary };
