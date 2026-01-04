import { cac } from 'cac'
import * as path from 'path'
import { promises as fs } from 'fs'
import prompts from 'prompts'
import { stat } from 'fs/promises'
import { spawn } from 'child_process'
import { build as tsupBuild } from 'tsup'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import crypto from 'crypto'

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

const cli = cac('yumeri-scripts')

cli
  .command('setup <name>', 'Create a new plugin')
  .action(async (rawName: string) => {
    const responses = await prompts([
      {
        type: 'select',
        name: 'templateType',
        message: 'Select a template for your plugin:',
        choices: [
          { title: 'Standard Plugin (backend only)', value: 'standard' },
          { title: 'UI Plugin (Vue + Vite)', value: 'ui-plugin' },
        ],
      },
      {
        type: 'text',
        name: 'description',
        message: 'Description:',
      },
    ]);

    if (!responses.templateType || !responses.description) {
      console.log('Plugin setup cancelled.');
      return;
    }

    const { templateType, description } = responses;
    const cwd = process.cwd()

    const isScoped = rawName.startsWith('@')
    const parts = rawName.split('/')
    const baseName = isScoped ? parts[1] : parts[0]
    const cleanName = baseName.startsWith('yumeri-plugin-') ? baseName.replace(/^yumeri-plugin-/, '') : baseName

    const folderName = baseName.startsWith('yumeri-plugin-') ? baseName : `yumeri-plugin-${baseName}`
    const pluginDir = path.join(cwd, 'plugins', folderName)

    const templateDir = path.resolve(__dirname, '../template', templateType)

    console.log(`Creating plugin at: ${pluginDir}`);
    console.log(`Using template: ${templateType}`);

    await copyTemplate(templateDir, pluginDir, cleanName, description)

    const pkgPath = path.join(cwd, 'package.json')
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))

    if (!pkg.workspaces) pkg.workspaces = []
    if (!pkg.workspaces.includes('plugins/*')) pkg.workspaces.push('plugins/*')

    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2))

    console.log('Running yarn to install dependencies...');
    await new Promise((resolve, reject) => {
      const child = spawn('yarn', [], { stdio: 'inherit', cwd })
      child.on('exit', (code: number) => {
        if (code === 0) {
          console.log('Plugin setup complete!');
          resolve(undefined)
        }
        else reject(new Error(`yarn exited with code ${code}`))
      })
    })
  })

cli
  .command('build <name>', 'Build a plugin with tsup')
  .option('--watch', 'Watch mode', { default: false })
  .action(async (name: string, options: { watch?: boolean }) => {
    const cwd = process.cwd()
    const candidates = [
      path.isAbsolute(name) ? name : path.join(cwd, name),
      path.join(cwd, 'plugins', name),
      path.join(cwd, 'common', name),
    ]

    let pluginDir: string | null = null
    // 先尝试 require.resolve 定位包根目录
    try {
      const resolved = require.resolve(path.join(name, 'package.json'), { paths: [cwd] })
      pluginDir = path.dirname(resolved)
    } catch {
      // ignore
    }
    for (const p of candidates) {
      if (pluginDir) break
      try {
        const st = await stat(p)
        if (st.isDirectory()) {
          pluginDir = p
          break
        }
      } catch {
        // ignore missing paths
      }
    }

    if (!pluginDir) {
      console.error(`Plugin directory not found for "${name}". Tried: ${candidates.join(', ')}`)
      process.exit(1)
    }

    console.log(`[yumeri-scripts] Building plugin at: ${pluginDir}`)

    const vuePlugin = {
      name: 'yumeri-vue-sfc',
      setup(build: any) {
        build.onLoad({ filter: /\.vue$/ }, async (args: any) => {
          const source = await fs.readFile(args.path, 'utf8')
          const { descriptor } = parse(source, { filename: args.path })
          const id = crypto.createHash('md5').update(args.path).digest('hex').slice(0, 8)

          let contents = ''
          if (descriptor.script || descriptor.scriptSetup) {
            const compiled = compileScript(descriptor, {
              id,
              inlineTemplate: !descriptor.template,
            })
            contents = compiled.content
          } else {
            contents = 'export default {}'
          }

          if (descriptor.template) {
            const tpl = compileTemplate({
              id,
              filename: args.path,
              source: descriptor.template.content,
              ssr: false,
            })
            contents += `\n${tpl.code}\n`
          }

          return {
            contents,
            loader: 'ts',
            resolveDir: path.dirname(args.path),
          }
        })
      },
    }

    const hasVue = await (async () => {
      try {
        const files = await fs.readdir(path.join(pluginDir, 'src'))
        return files.some((f) => f.endsWith('.vue')) || files.some((f) => f === 'views')
      } catch {
        return false
      }
    })()

    await tsupBuild({
      entry: [path.join(pluginDir, 'src/index.ts')],
      format: ['esm', 'cjs'],
      dts: hasVue
        ? {
            banner:
              "declare module '*.vue' { import type { DefineComponent } from 'vue'; const component: DefineComponent<any, any, any>; export default component; }",
        }
        : true,
      clean: true,
      outDir: path.join(pluginDir, 'dist'),
      splitting: false,
      sourcemap: false,
      target: 'esnext',
      tsconfig: path.join(pluginDir, 'tsconfig.json'),
      esbuildPlugins: hasVue ? [vuePlugin as any] : undefined,
      esbuildOptions(options) {
        if (hasVue) {
          options.loader = { ...options.loader, '.vue': 'ts' }
        }
      },
      watch: options.watch ?? false,
      minify: false,
      shims: false,
    })
  })

cli.help()
cli.parse()
