/**
 * Single source of truth for every version- and database-specific fact the
 * generators need.
 *
 * Every package name, class name and constructor shape below was verified
 * against the real npm registry and by runtime introspection of the installed
 * adapters. Do not edit from memory — re-verify before changing.
 */

/** Prisma releases the CLI is allowed to install. */
const PRISMA_VERSIONS = [
    {
        value: '7.10.0',
        label: 'Prisma 7.10.0',
        hint: 'latest stable',
        // Copied from the "engines" field of prisma@7.10.0 and @prisma/client@7.10.0.
        nodeRange: '^20.19 || ^22.12 || >=24.0',
        isDefault: true,
    },
];

/**
 * Driver adapter matrix.
 *
 * Notes on why this looks the way it does:
 *  - `@prisma/adapter-mysql2` does NOT exist on npm (404). The real package for
 *    the MySQL family is `@prisma/adapter-mariadb`, exporting `PrismaMariaDb`.
 *  - Adapters already depend on their own driver (`adapter-pg` -> `pg` +
 *    `@types/pg`; `adapter-mariadb` -> `mariadb`), so we must NOT ask the user's
 *    project to install `pg` / `mysql2` / `@types/*` separately.
 *  - Both adapter constructors accept a plain connection string, so no
 *    connection Pool object is needed in the generated service.
 */
const DATABASES = {
    postgres: {
        value: 'postgres',
        label: 'PostgreSQL',
        icon: '🐘',
        /** value passed to `prisma init --datasource-provider` */
        datasourceProvider: 'postgresql',
        adapterPackage: '@prisma/adapter-pg',
        adapterClass: 'PrismaPg',
        exampleUrl: 'postgresql://user:password@localhost:5432/mydb?schema=public',
    },
    mysql: {
        value: 'mysql',
        label: 'MySQL / MariaDB / Percona',
        icon: '🐬',
        datasourceProvider: 'mysql',
        adapterPackage: '@prisma/adapter-mariadb',
        adapterClass: 'PrismaMariaDb',
        exampleUrl: 'mysql://user:password@localhost:3306/mydb',
    },
};

/**
 * Resolve the exact dependency lists for a given answer set.
 *
 * @param {{ version: string, database: keyof typeof DATABASES }} options
 */
function resolveDependencies({ version, database }) {
    const db = DATABASES[database];
    if (!db) {
        throw new Error(`Unknown database provider: ${database}`);
    }

    return {
        // Runtime deps. The adapter pulls in its own driver + types. `dotenv`
        // is a runtime dep because PrismaService loads .env with it (Nest does
        // not read .env on its own), and the generated prisma config file
        // imports it too.
        dependencies: [`@prisma/client@${version}`, db.adapterPackage, 'dotenv'],
        devDependencies: [`prisma@${version}`],
    };
}

function getDatabase(database) {
    const db = DATABASES[database];
    if (!db) {
        throw new Error(`Unknown database provider: ${database}`);
    }
    return db;
}

function getDefaultVersion() {
    const found = PRISMA_VERSIONS.find((v) => v.isDefault) || PRISMA_VERSIONS[0];
    return found.value;
}

function isSupportedVersion(version) {
    return PRISMA_VERSIONS.some((v) => v.value === version);
}

function getVersion(version) {
    const found = PRISMA_VERSIONS.find((v) => v.value === version);
    if (!found) throw new Error(`Unsupported Prisma version: ${version}`);
    return found;
}

module.exports = {
    PRISMA_VERSIONS,
    DATABASES,
    resolveDependencies,
    getDatabase,
    getDefaultVersion,
    getVersion,
    isSupportedVersion,
};
