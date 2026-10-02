const fs = require('fs');
const path = require('path');

const { CliError } = require('./errors');

/** Parses "v22.17.1" / "22.17.1" into [22, 17, 1]. */
function parseVersion(version) {
    return String(version).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
}

/**
 * Minimal checker for engine ranges shaped like "^20.19 || ^22.12 || >=24.0",
 * which is the form Prisma publishes. Avoids pulling in `semver`.
 */
function satisfiesNodeRange(current, range) {
    const [maj, min, pat] = parseVersion(current);
    const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    const cur = [maj, min, pat];

    return range.split('||').some((part) => {
        const clause = part.trim();
        const m = clause.match(/^(\^|>=)?\s*(\d+(?:\.\d+){0,2})$/);
        if (!m) return false;
        const want = parseVersion(m[2]);
        while (want.length < 3) want.push(0);
        if (m[1] === '>=') return cmp(cur, want) >= 0;
        if (m[1] === '^') return cur[0] === want[0] && cmp(cur, want) >= 0;
        return cmp(cur, want) === 0;
    });
}

function readPackageJson(projectRoot) {
    const file = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(file)) {
        throw new CliError('No package.json found in the current directory.', {
            hints: [`Current directory: ${projectRoot}`, 'Run this command from the root of your NestJS project.'],
        });
    }
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        throw new CliError('package.json is not valid JSON.', { hints: [err.message], cause: err });
    }
}

/**
 * Validates that we are inside a NestJS project on a supported Node version.
 * Throws a CliError describing exactly what is wrong; returns facts otherwise.
 *
 * @param {string} projectRoot
 * @param {{ nodeRange: string, nodeVersion?: string }} requirements
 */
function runPreflight(projectRoot, { nodeRange, nodeVersion = process.version }) {
    if (!satisfiesNodeRange(nodeVersion, nodeRange)) {
        throw new CliError(`Node.js ${nodeVersion} is not supported by Prisma.`, {
            hints: [`Prisma requires Node.js ${nodeRange}.`, 'Upgrade Node.js and run the command again.'],
        });
    }

    const pkgJson = readPackageJson(projectRoot);
    const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };

    if (!allDeps['@nestjs/core'] && !allDeps['@nestjs/common']) {
        throw new CliError("This doesn't look like a NestJS project.", {
            hints: [
                'package.json does not list @nestjs/core or @nestjs/common.',
                'Create one first with: npx @nestjs/cli new my-app',
            ],
        });
    }

    if (!fs.existsSync(path.join(projectRoot, 'src'))) {
        throw new CliError('No "src" folder found.', {
            hints: ['Run this command from the root of your NestJS project.'],
        });
    }

    if (pkgJson.type === 'module') {
        throw new CliError('ESM projects ("type": "module") are not supported yet.', {
            hints: ['The generated Prisma Client is configured for CommonJS, which is what Nest uses by default.'],
        });
    }

    return { pkgJson };
}

module.exports = { runPreflight, satisfiesNodeRange, readPackageJson };
