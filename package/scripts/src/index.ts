import { cac } from 'cac'
import * as path from 'path'
import { promises as fs } from 'fs'

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

async function outputFile(filePath: string, data: string) {
  await ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, data)
}

function replaceTemplate(content: string, name: string, description: string) {
  return content
    .replace(/{{name}}/g, name)
    .replace(/{{description}}/g, description)
}

async function copyTemplate(templateDir: string, targetDir: string, name: string, description: string) {
  await ensureDir(targetDir)
  const files = await fs.readdir(templateDir)
  for (const file of files) {
    const srcPath = path.join(templateDir, file)
    const destPath = path.join(targetDir, file)
    const stat = await fs.stat(srcPath)
    if (stat.isDirectory()) {
      await copyTemplate(srcPath, destPath, name, description)
    } else {
      let content = await fs.readFile(srcPath, 'utf-8')
      content = replaceTemplate(content, name, description)
      await outputFile(destPath, content)
    }
  }
}

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    process.stdin.once('data', (data) => {
      process.stdin.pause()
      resolve(data.toString().trim())
    })
  })
}

const cli = cac('yumeri-scripts')

cli
  .command('setup <name>', 'Create a new plugin')
  .action(async (rawName: string) => {
    const description = await prompt('Description: ')
    const cwd = process.cwd()

    const isScoped = rawName.startsWith('@')
    const parts = rawName.split('/')
    const baseName = isScoped ? parts[1] : parts[0]
    const cleanName = baseName.startsWith('yumeri-plugin-') ? baseName.replace(/^yumeri-plugin-/, '') : baseName

    const folderName = baseName.startsWith('yumeri-plugin-') ? baseName : `yumeri-plugin-${baseName}`
    const pluginDir = path.join(cwd, 'plugins', folderName)

    const templateDir = path.resolve(__dirname, '../template')

    await copyTemplate(templateDir, pluginDir, cleanName, description)

    const pkgPath = path.join(cwd, 'package.json')
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))

    if (!pkg.workspaces) pkg.workspaces = []
    if (!pkg.workspaces.includes('plugins/*')) pkg.workspaces.push('plugins/*')

    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2))

    await new Promise((resolve, reject) => {
      const child = require('child_process').spawn('yarn', [], { stdio: 'inherit', cwd })
      child.on('exit', (code: number) => {
        if (code === 0) resolve(undefined)
        else reject(new Error(`yarn exited with code ${code}`))
      })
    })
  })

cli.help()
cli.parse()
