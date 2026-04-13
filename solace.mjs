#!/usr/bin/env node

import path from 'path';
import fs from 'fs/promises';
import crypto from 'node:crypto';
import chalk from 'chalk';
import * as Diff from 'diff';
import { Command } from 'commander';

const program = new Command();

class Solace {
    constructor(repoPath = '.') {
        this.repoPath = path.join(repoPath, '.solace');
        this.objectsPath = path.join(this.repoPath, 'objects');
        this.refsPath = path.join(this.repoPath, 'refs', 'heads');
        this.headPath = path.join(this.repoPath, 'HEAD');
        this.indexPath = path.join(this.repoPath, 'index');
        this.configPath = path.join(this.repoPath, 'config.json');
        this.ignorePath = path.join(process.cwd(), '.solaceignore');

        this.SECRET_PATTERNS = [
            { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/g },
            { name: "Google API Key", regex: /AIza[0-9A-Za-z\-_]{35}/g },
            { name: "Generic Secret", regex: /(api_key|secret|password)\s*[:=]\s*['"][^'"]{6,}['"]/gi },
        ];
    }

    //  init 
    async init() {
        try {
            await fs.mkdir(this.objectsPath, { recursive: true });
            await fs.mkdir(this.refsPath, { recursive: true });
            await fs.writeFile(this.headPath, 'ref: refs/heads/main', { flag: 'wx' });
            await fs.writeFile(this.indexPath, JSON.stringify([]), { flag: 'wx' });

            const config = {
                version: '1.0.0',
                createdAt: new Date().toISOString(),
                defaultBranch: 'main',
            };
            await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), { flag: 'wx' });

            const ignoreTemplate = [
                '# Solace ignore file',
                'node_modules/',
                '.env',
                '*.log',
                'dist/',
                '.DS_Store',
            ].join('\n') + '\n';
            await fs.writeFile(this.ignorePath, ignoreTemplate, { flag: 'wx' });

            console.log(chalk.green("\n Solace repository initialized successfully!"));
            console.log(chalk.gray("   Created → .solace/objects/"));
            console.log(chalk.gray("   Created → .solace/refs/heads/"));
            console.log(chalk.gray("   Created → .solace/config.json"));
            console.log(chalk.gray("   Created → .solaceignore"));
            console.log(chalk.cyan(`\n   Default branch: ${chalk.bold('main')}\n`));

        } catch (error) {
            if (error.code === 'EEXIST') {
                console.log(chalk.yellow("  Already initialized: .solace folder already exists."));
            } else {
                console.error(chalk.red("Initialization error:"), error);
            }
        }
    }
    //  hashing 
    hashObject(content) {
        return crypto.createHash('sha1').update(content, 'utf-8').digest('hex');
    }
    //  secret guardian 
    async scanForSecrets(content) {
        const foundSecrets = [];
        for (const pattern of this.SECRET_PATTERNS) {
            pattern.regex.lastIndex = 0; // reset stateful g-flag regex
            if (pattern.regex.test(content)) {
                foundSecrets.push(pattern.name);
            }
        }
        return foundSecrets;
    }
    //  ignore rules 
    async getIgnorePatterns() {
        try {
            const raw = await fs.readFile(this.ignorePath, 'utf-8');
            return raw
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));
        } catch {
            return [];
        }
    }

    isIgnored(filePath, patterns) {
        return patterns.some(pattern => {
            if (pattern.endsWith('/')) return filePath.includes(pattern.slice(0, -1));
            if (pattern.startsWith('*')) return filePath.endsWith(pattern.slice(1));
            return filePath.includes(pattern);
        });
    }
    //  add
    async add(fileToBeAdded) {
        try {
            try {
                await fs.access(fileToBeAdded);
            } catch {
                console.log(chalk.red(` File not found: ${fileToBeAdded}`));
                return;
            }

            const ignorePatterns = await this.getIgnorePatterns();
            if (this.isIgnored(fileToBeAdded, ignorePatterns)) {
                console.log(chalk.yellow(`  Skipped (ignored): ${fileToBeAdded}`));
                return;
            }

            const fileData = await fs.readFile(fileToBeAdded, { encoding: 'utf-8' });

            const detectedSecrets = await this.scanForSecrets(fileData);
            if (detectedSecrets.length > 0) {
                console.log(chalk.red.bold("\n  SECRET GUARDIAN ALERT!"));
                console.log(chalk.red(`   Security risk detected in: ${chalk.bold(fileToBeAdded)}`));
                detectedSecrets.forEach(s => console.log(chalk.yellow(`   ⚠  Possible ${s}`)));
                console.log(chalk.red.bold("   Action blocked to prevent credential leak.\n"));
                return;
            }

            const fileHash = this.hashObject(fileData);
            await fs.writeFile(path.join(this.objectsPath, fileHash), fileData);

            const indexData = JSON.parse(await fs.readFile(this.indexPath, 'utf-8'));
            const filteredIndex = indexData.filter(f => f.path !== fileToBeAdded);
            filteredIndex.push({ path: fileToBeAdded, hash: fileHash });

            await fs.writeFile(this.indexPath, JSON.stringify(filteredIndex, null, 2));
            console.log(chalk.blue(` Staged: ${fileToBeAdded}`));

        } catch (error) {
            console.error(chalk.red("Error adding file:"), error.message);
        }
    }
    //  commit 
    async commit(message) {
        try {
            const index = JSON.parse(await fs.readFile(this.indexPath, 'utf-8'));
            if (index.length === 0) {
                return console.log(chalk.yellow("Nothing to commit (staging area is empty)."));
            }

            const parent = await this.resolveHead();

            const commitData = {
                timeStamp: new Date().toISOString(),
                message,
                files: index,
                parent,
            };

            const commitHash = this.hashObject(JSON.stringify(commitData));
            await fs.writeFile(
                path.join(this.objectsPath, commitHash),
                JSON.stringify(commitData, null, 2)
            );

            const branch = await this.getCurrentBranch();
            const branchRefPath = path.join(this.refsPath, branch);
            await fs.writeFile(branchRefPath, commitHash);
            await fs.writeFile(this.headPath, `ref: refs/heads/${branch}`);
            await fs.writeFile(this.indexPath, JSON.stringify([]));

            console.log(chalk.magenta(`\n Committed to ${chalk.bold(branch)}: [${commitHash.slice(0, 7)}] ${message}\n`));

        } catch (err) {
            console.error(chalk.red("Commit failed:"), err);
        }
    }
    //  log 
    async log() {
        let currentHash = await this.resolveHead();
        if (!currentHash) return console.log(chalk.gray("\nNo commits yet.\n"));

        const branch = await this.getCurrentBranch();
        console.log(chalk.cyan.bold(`\n COMMIT HISTORY  `) + chalk.gray(`[branch: ${branch}]`));

        while (currentHash) {
            const data = await this.getCommitData(currentHash);
            if (!data) break;
            console.log(chalk.gray("\n─────────────────────────────"));
            console.log(`${chalk.magenta("commit")} ${chalk.yellow(currentHash)}`);
            console.log(`${chalk.blue("Date:  ")} ${data.timeStamp}`);
            console.log(`${chalk.white("Msg:   ")} ${data.message}`);
            console.log(`${chalk.gray("Files: ")} ${data.files.map(f => f.path).join(', ')}`);
            currentHash = data.parent;
        }
        console.log("");
    }
    //  status 
    async status() {
        try {
            const index = JSON.parse(await fs.readFile(this.indexPath, 'utf-8'));
            const branch = await this.getCurrentBranch();

            console.log(chalk.cyan.bold("\n REPOSITORY STATUS"));
            console.log(chalk.gray(`   Branch: ${chalk.white(branch)}`));

            if (index.length === 0) {
                console.log(chalk.gray("   Staging area is empty.\n"));
            } else {
                console.log(chalk.green(`\n   Staged files (${index.length}):`));
                index.forEach(f => console.log(chalk.green(`   ✔ ${f.path}`)));
                console.log("");
            }
        } catch (err) {
            console.error(chalk.red("Status error:"), err);
        }
    }
    //  diff
    async diff(h1, h2) {
        const c1 = await this.getCommitData(h1);
        const c2 = await this.getCommitData(h2);
        if (!c1 || !c2) return console.log(chalk.red(" One or both commits not found."));

        const allPaths = new Set([
            ...c1.files.map(f => f.path),
            ...c2.files.map(f => f.path),
        ]);

        console.log(chalk.cyan.bold(`\n🔍 Diff: ${h1.slice(0, 7)} → ${h2.slice(0, 7)}`));

        for (const filePath of allPaths) {
            const f1 = c1.files.find(f => f.path === filePath);
            const f2 = c2.files.find(f => f.path === filePath);

            const content1 = f1 ? await this.getFileContent(f1.hash) : "";
            const content2 = f2 ? await this.getFileContent(f2.hash) : "";

            if (!f1) console.log(chalk.green(`\n  [ADDED]   ${filePath}`));
            else if (!f2) console.log(chalk.red(`\n  [DELETED] ${filePath}`));
            else console.log(chalk.cyan(`\n  [CHANGED] ${filePath}`));

            const differences = Diff.diffLines(content1, content2);
            differences.forEach((part) => {
                const color = part.added ? chalk.green : part.removed ? chalk.red : chalk.gray;
                const prefix = part.added ? "+ " : part.removed ? "- " : "  ";
                process.stdout.write(color(prefix + part.value));
            });
        }
        console.log("");
    }

    //  helpers 
    async getCurrentBranch() {
        try {
            const headContent = (await fs.readFile(this.headPath, 'utf-8')).trim();
            if (headContent.startsWith('ref: refs/heads/')) {
                return headContent.replace('ref: refs/heads/', '');
            }
            return 'main';
        } catch {
            return 'main';
        }
    }

    async resolveHead() {
        try {
            const headContent = (await fs.readFile(this.headPath, 'utf-8')).trim();
            if (headContent.startsWith('ref: ')) {
                const refPath = path.join(this.repoPath, headContent.slice(5));
                try {
                    return (await fs.readFile(refPath, 'utf-8')).trim() || null;
                } catch {
                    return null;
                }
            }
            return headContent || null;
        } catch {
            return null;
        }
    }

    async getCommitData(hash) {
        try {
            return JSON.parse(await fs.readFile(path.join(this.objectsPath, hash), 'utf-8'));
        } catch {
            return null;
        }
    }

    async getFileContent(hash) {
        return await fs.readFile(path.join(this.objectsPath, hash), 'utf-8');
    }
}

//  cli- commander config 
const solace = new Solace();

program
    .name('solace')
    .description('A lightweight version control system')
    .version('1.0.0');

program
    .command('init')
    .description('Initialize a new .solace repository')
    .action(() => solace.init());

program
    .command('add <file>')
    .description('Stage a file for commit')
    .action((file) => solace.add(file));

program
    .command('commit <message>')
    .description('Commit staged files with a message')
    .action((message) => solace.commit(message));

program
    .command('log')
    .description('Display commit history')
    .action(() => solace.log());

program
    .command('status')
    .description('Show staged files and current branch')
    .action(() => solace.status());

program
    .command('diff <h1> <h2>')
    .description('Show differences between two commits')
    .action((h1, h2) => solace.diff(h1, h2));

program.parse(process.argv);