#!/usr/bin/env node

const { cac } = require('cac')
const { runMain } = require('./dist/run')

const cli = cac('yumeri')

cli
  .command('start', 'Run Yumeri')
  .allowUnknownOptions()
  .action(async () => {
    await runMain()
  })

cli.help()
cli.parse()