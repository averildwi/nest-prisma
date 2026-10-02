const { parseArgs } = require('util');

const { CliError } = require('./errors');
const { DATABASES, PRISMA_VERSIONS } = require('./config/registry');
const { PACKAGE_MANAGERS } = require('./utils/packageManager');

const OPTIONS = {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
    yes: { type: 'boolean', short: 'y' },
    'dry-run': { type: 'boolean' },
    db: { type: 'string' },
    prisma: { type: 'string' },
    pm: { type: 'string' },
    generate: { type: 'boolean' },
    'no-generate': { type: 'boolean' },
    install: { type: 'boolean' },
    'no-install': { type: 'boolean' },
    color: { type: 'boolean' },
    'no-color': { type: 'boolean' },
};

/** Accept common spellings so `--db pg` or `--db mariadb` just work. */
const DB_ALIASES = {
    postgres: 'postgres',
    postgresql: 'postgres',
    pg: 'postgres',
    mysql: 'mysql',
    mariadb: 'mysql',
    percona: 'mysql',
};

function pickBoolean(values, name) {
    if (values[`no-${name}`]) return false;
    if (values[name]) return true;
    return undefined;
}

/**
 * Parses process arguments into a normalised options object.
 * Unspecified options are left `undefined` so the caller can decide whether to
 * prompt for them or fall back to defaults.
 */
function parseCliArgs(argv = process.argv.slice(2)) {
    let parsed;
    try {
        parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false, strict: true });
    } catch (err) {
        throw new CliError(err.message.replace(/\. To specify.*$/s, '.'), {
            hints: ['Run "nest-prisma --help" to see all available options.'],
            exitCode: 2,
        });
    }

    const v = parsed.values;
    const options = {
        help: Boolean(v.help),
        version: Boolean(v.version),
        yes: Boolean(v.yes),
        dryRun: Boolean(v['dry-run']),
        database: undefined,
        prismaVersion: undefined,
        packageManager: undefined,
        runGenerate: pickBoolean(v, 'generate'),
        install: pickBoolean(v, 'install'),
        color: pickBoolean(v, 'color'),
    };

    if (v.db !== undefined) {
        const db = DB_ALIASES[v.db.toLowerCase()];
        if (!db) {
            throw new CliError(`Unknown database "${v.db}".`, {
                hints: [`Supported values: ${Object.keys(DATABASES).join(', ')} (aliases: pg, postgresql, mariadb).`],
                exitCode: 2,
            });
        }
        options.database = db;
    }

    if (v.prisma !== undefined) {
        if (!PRISMA_VERSIONS.some((p) => p.value === v.prisma)) {
            throw new CliError(`Unsupported Prisma version "${v.prisma}".`, {
                hints: [`Supported versions: ${PRISMA_VERSIONS.map((p) => p.value).join(', ')}.`],
                exitCode: 2,
            });
        }
        options.prismaVersion = v.prisma;
    }

    if (v.pm !== undefined) {
        const pm = v.pm.toLowerCase();
        if (!PACKAGE_MANAGERS[pm]) {
            throw new CliError(`Unknown package manager "${v.pm}".`, {
                hints: [`Supported values: ${Object.keys(PACKAGE_MANAGERS).join(', ')}.`],
                exitCode: 2,
            });
        }
        options.packageManager = pm;
    }

    return options;
}

function helpText(pkg) {
    const dbs = Object.keys(DATABASES).join(' | ');
    return `
  ${pkg.name} v${pkg.version}
  Set up Prisma ORM with a driver adapter in an existing NestJS project.

  Usage
    $ npx ${pkg.name} [options]

  Options
    --db <name>        Database provider: ${dbs}
    --prisma <ver>     Prisma version to install (default: latest supported)
    --pm <name>        Package manager: npm | pnpm | yarn | bun (default: auto-detect)
    --no-generate      Skip running "prisma generate" at the end
    --no-install       Skip installing dependencies (only write files)
    -y, --yes          Accept defaults and skip all prompts
    --dry-run          Show what would change without touching anything
    --no-color         Disable coloured output
    -v, --version      Print the version
    -h, --help         Show this help

  Examples
    $ npx ${pkg.name}
    $ npx ${pkg.name} --db postgres --yes
    $ npx ${pkg.name} --db mysql --pm pnpm --dry-run
`;
}

module.exports = { parseCliArgs, helpText };
