const { CancelledError, CliError } = require('./errors');
const { PRISMA_VERSIONS, DATABASES, getDefaultVersion } = require('./config/registry');

async function loadInquirer() {
    // inquirer 9 is ESM-only, so it has to be loaded with a dynamic import.
    const { default: inquirer } = await import('inquirer');
    return inquirer;
}

/** inquirer rejects with this when the user presses Ctrl+C. */
function isPromptAbort(err) {
    return err && (err.name === 'ExitPromptError' || err.isTtyError === false || /force closed/i.test(err.message || ''));
}

async function prompt(questions) {
    const inquirer = await loadInquirer();
    try {
        return await inquirer.prompt(questions);
    } catch (err) {
        if (isPromptAbort(err)) throw new CancelledError();
        throw err;
    }
}

/**
 * Fills in every option the user did not pass as a flag.
 * With --yes (or without a TTY) defaults are used instead of prompting.
 */
async function resolveAnswers(options, { interactive }) {
    const answers = {
        prismaVersion: options.prismaVersion,
        database: options.database,
        clientOutput: options.clientOutput,
        runGenerate: options.runGenerate,
    };

    const missingDb = answers.database === undefined;

    if (!interactive) {
        if (missingDb) {
            throw new CliError('Choose a database with --db when running non-interactively.', {
                hints: [
                    `Supported values: ${Object.keys(DATABASES).join(', ')}.`,
                    'Example: npx @averildwi/nest-prisma --db postgres --yes',
                ],
                exitCode: 2,
            });
        }
        return {
            prismaVersion: answers.prismaVersion ?? getDefaultVersion(),
            database: answers.database,
            clientOutput: answers.clientOutput ?? 'src',
            runGenerate: answers.runGenerate ?? true,
        };
    }

    const questions = [];

    if (answers.database === undefined) {
        questions.push({
            type: 'list',
            name: 'database',
            message: 'Which database are you using?',
            choices: Object.values(DATABASES).map((db) => ({
                name: `${db.icon}  ${db.label}`,
                value: db.value,
            })),
        });
    }

    // Only ask about the version when there is an actual choice to make.
    if (answers.prismaVersion === undefined && PRISMA_VERSIONS.length > 1) {
        questions.push({
            type: 'list',
            name: 'prismaVersion',
            message: 'Which Prisma version?',
            default: getDefaultVersion(),
            choices: PRISMA_VERSIONS.map((v) => ({ name: `${v.label} (${v.hint})`, value: v.value })),
        });
    }

    if (answers.clientOutput === undefined) {
        questions.push({
            type: 'list',
            name: 'clientOutput',
            message: 'Where should the generated Prisma Client live?',
            default: 'src',
            choices: [
                { name: '📁  Inside src (src/generated/prisma) — recommended, no build config changes', value: 'src' },
                { name: '📁  Project root (generated/prisma) — start:prod path is adjusted automatically', value: 'root' },
            ],
        });
    }

    if (answers.runGenerate === undefined) {
        questions.push({
            type: 'confirm',
            name: 'runGenerate',
            message: 'Generate Prisma Client when setup finishes?',
            default: true,
        });
    }

    const prompted = questions.length ? await prompt(questions) : {};

    return {
        prismaVersion: answers.prismaVersion ?? prompted.prismaVersion ?? getDefaultVersion(),
        database: answers.database ?? prompted.database,
        clientOutput: answers.clientOutput ?? prompted.clientOutput ?? 'src',
        runGenerate: answers.runGenerate ?? prompted.runGenerate ?? true,
    };
}

async function confirmPlan() {
    const { proceed } = await prompt([
        { type: 'confirm', name: 'proceed', message: 'Apply these changes?', default: true },
    ]);
    if (!proceed) throw new CancelledError();
}

module.exports = { resolveAnswers, confirmPlan };
