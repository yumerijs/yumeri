#!/usr/bin/env node

import { spawn } from 'child_process'
import { cac } from 'cac'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const pkg = require('./package.json')

const __filename = fileURLToPath(import.meta.url)

function startWorker() {
    const args = process.argv.slice(2)
    const startIdx = args.indexOf('start')
    
    const nodeOptions = startIdx !== -1 ? args.slice(0, startIdx) : []
    const commandArgs = startIdx !== -1 ? args.slice(startIdx + 1) : args

    const nodeArgs = [
        ...nodeOptions,
        __filename,
        '--worker',
        ...commandArgs
    ]

    console.log(`[Manager] Spawning worker: node ${nodeArgs.join(' ')}`)

    const worker = spawn('node', nodeArgs, {
        stdio: 'inherit'
    })

    worker.on('exit', (code, signal) => {
        if (code === 0 || signal === 'SIGTERM') {
            console.log('[Manager] Worker exited cleanly.')
            return
        }

        if (code === 10) {
            console.log('[Manager] Restarting.')
            setTimeout(startWorker, 2000)
            return
        }

        console.error(`[Manager] Worker exited with code ${code}, signal ${signal}`)
        // setTimeout(startWorker, 2000)
    })

    worker.on('error', (err) => {
        console.error('[Manager] Failed to start worker:', err)
    })
}

/**
 * Main function
 */
async function main() {
    if (process.argv.includes('--worker')) {
        process.argv.splice(process.argv.indexOf('--worker'), 1)

        try {
            const { runMain } = await import('./dist/run.js')
            runMain()
        } catch (e) {
            console.error('[Worker] Failed to start:', e)
            process.exit(1)
        }
    } else {
        const cli = cac('yumeri')

        cli
            .command('start', 'Run Yumeri')
            .allowUnknownOptions()
            .action(startWorker)

        cli.help()
        cli.version(pkg.version)

        cli.parse()
    }
}

await main()
