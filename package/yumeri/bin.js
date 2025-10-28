#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

// --- State for Auto-Restart ---
let restartAttempts = 0;
let lastRestartTimestamp = 0;
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60000; // 1 minute

/**
 * The function that spawns and manages the worker process.
 */
function startWorker() {
    const isDev = process.env.NODE_ENV === 'development';

    // Construct arguments for the node process.
    const nodeArgs = [];
    if (isDev) {
        nodeArgs.push('-r', 'esbuild-register', '-r', 'tsconfig-paths/register');
    }

    // Add the script to run (this file itself) and the worker flag.
    nodeArgs.push(__filename, '--worker');

    // Pass along any other arguments from the original command.
    const originalArgs = process.argv.slice(2);
    // Filter out the 'start' command as we are already handling it.
    const filteredArgs = originalArgs.filter(arg => arg !== 'start');
    nodeArgs.push(...filteredArgs);

    console.log(`[Manager] Spawning worker: node ${nodeArgs.join(' ')}`);

    const worker = spawn('node', nodeArgs, {
        stdio: 'inherit' // Pipe all I/O to the parent process.
    });

    worker.on('exit', (code, signal) => {
        // 如果退出码是0或者SIGTERM，表示正常退出
        if (code === 0 || signal === 'SIGTERM') {
            console.log('[Manager] Worker exited cleanly.');
            return;
        }

        // 如果退出码是10，表示应用要求重启，清零重试次数
        if (code === 10) {
            console.log('[Manager] Restarting.');
            restartAttempts = 0;
            // 直接在2秒后重启
            setTimeout(startWorker, 2000);
            return;
        }

        console.error(`[Manager] Worker process exited with code ${code} and signal ${signal}.`);

        const now = Date.now();
        // 如果上一次重启已经很久以前，重置尝试次数
        if (now - lastRestartTimestamp > RESTART_WINDOW_MS) {
            restartAttempts = 0;
        }

        lastRestartTimestamp = now;

        if (restartAttempts < MAX_RESTARTS) {
            restartAttempts++;
            console.log(`[Manager] Restarting in 2 seconds... (Attempt ${restartAttempts}/${MAX_RESTARTS})`);
            setTimeout(startWorker, 2000);
        } else {
            console.error('[Manager] Maximum restart attempts reached. Not restarting again.');
            process.exit(1);
        }
    });

    worker.on('error', (err) => {
        console.error('[Manager] Failed to start worker process:', err);
    });
}

/**
 * Main function to determine if we are in manager or worker mode.
 */
function main() {
    // If the '--worker' flag is present, this is the worker process.
    if (process.argv.includes('--worker')) {
        // Remove the flag so the application logic doesn't see it.
        const workerArgIndex = process.argv.indexOf('--worker');
        process.argv.splice(workerArgIndex, 1);

        // Run the actual Yumeri application.
        try {
            require('./dist/run').runMain();
        } catch (e) {
            console.error("[Worker] Failed to start Yumeri core:", e);
            process.exit(1);
        }
    } else {
        // This is the manager process. Set up the CLI.
        const { cac } = require('cac');
        const cli = cac('yumeri');

        cli
            .command('start', 'Run Yumeri')
            .allowUnknownOptions() // Allows passing other options to the worker
            .action(() => {
                startWorker();
            });

        cli.help();
        cli.version(require('./package.json').version);
        cli.parse();
    }
}

// Run the main logic.
main();