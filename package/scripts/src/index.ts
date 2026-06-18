import { cac } from 'cac'
import * as path from 'path'
import { promises as fs } from 'fs'
import prompts from 'prompts'
import { stat } from 'fs/promises'
import { spawn } from 'child_process'
import { build as tsupBuild } from 'tsup'

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
    const fileStat = await fs.stat(srcPath)
    if (fileStat.isDirectory()) {
      await copyTemplate(srcPath, destPath, name, description)
    } else {
      let content = await fs.readFile(srcPath, 'utf-8')
      content = replaceTemplate(content, name, description)
      await outputFile(destPath, content)
    }
  }
}

const cli = cac('yumeri-scripts')

// ==================== SETUP COMMAND ====================
cli
  .command('setup <name>', 'Create a new plugin')
  .action(async (rawName: string) => {
    // 移除 UI 模板选项，只保留 description 输入
    const responses = await prompts([
      {
        type: 'text',
        name: 'description',
        message: 'Description:',
      },
    ]);

    if (!responses.description) {
      console.log('Plugin setup cancelled.');
      return;
    }

    const { description } = responses;
    const templateType = 'standard'; // 默认 standard，不再支持 ui-plugin
    const cwd = process.cwd()
    const isScoped = rawName.startsWith('@')
    const parts = rawName.split('/')
    const baseName = isScoped ? parts[1] : parts[0]
    const cleanName = baseName.startsWith('yumeri-plugin-') ? baseName.replace(/^yumeri-plugin-/, '') : baseName
    const folderName = baseName.startsWith('yumeri-plugin-') ? baseName : `yumeri-plugin-${baseName}`
    
    const pluginDir = path.join(cwd, 'plugins', folderName)
    const templateDir = path.resolve(__dirname, '../template', templateType)

    console.log(`Creating plugin at: ${pluginDir}`);
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
        } else reject(new Error(`yarn exited with code ${code}`))
      })
    })
  })

// ==================== BUILD COMMAND ====================
cli
  .command('build [...names]', 'Build one or multiple plugins')
  .option('--watch', 'Watch mode', { default: false })
  .option('--dir <dir>', 'Base directory of plugins', { default: 'plugins' })
  .action(async (names: string[], options: { watch?: boolean; dir: string }) => {
    const cwd = process.cwd()
    const baseDir = path.isAbsolute(options.dir) ? options.dir : path.join(cwd, options.dir)
    let targetPlugins: string[] = [...names]

    // 1. 自动扫描与确认逻辑（保持不变）
    if (targetPlugins.length === 0) {
      try {
        const files = await fs.readdir(baseDir)
        const dirs: string[] = []
        for (const file of files) {
          const st = await stat(path.join(baseDir, file))
          if (st.isDirectory()) dirs.push(file)
        }
        if (dirs.length === 0) {
          console.error(`[yumeri-scripts] No plugins found in directory: ${baseDir}`)
          process.exit(1)
        }
        const confirm = await prompts({
          type: 'confirm',
          name: 'value',
          message: `No plugin specified. Do you want to build ALL plugins (${dirs.length} found) in "${options.dir}"?`,
          initial: false
        })
        if (!confirm.value) {
          console.log('Build cancelled.')
          return
        }
        targetPlugins = dirs
      } catch (err) {
        console.error(`[yumeri-scripts] Failed to read directory: ${baseDir}`)
        process.exit(1)
      }
    }

    // 2. 依次调用 tsc 编译每个插件
    const total = targetPlugins.length
    for (let i = 0; i < total; i++) {
      const name = targetPlugins[i]
      const progressPrefix = `[${i + 1}/${total}]`
      
      const candidates = [
        path.isAbsolute(name) ? name : path.join(cwd, name),
        path.join(baseDir, name),
        path.join(cwd, 'common', name),
      ]
      
      let pluginDir: string | null = null
      try {
        const resolved = require.resolve(path.join(name, 'package.json'), { paths: [cwd] })
        pluginDir = path.dirname(resolved)
      } catch { /* ignore */ }

      for (const p of candidates) {
        if (pluginDir) break
        try {
          const st = await stat(p)
          if (st.isDirectory()) {
            pluginDir = p
            break
          }
        } catch { /* ignore */ }
      }

      if (!pluginDir) {
        console.error(`\n${progressPrefix} ❌ Error: Plugin directory not found for "${name}"`)
        continue
      }

      console.log(`\n${progressPrefix} 🚀 Building with tsc: ${path.basename(pluginDir)}`)

      // 构造 tsc 命令参数，使用插件目录下的 tsconfig.json
      const tsconfigPath = path.normalize(path.join(pluginDir, 'tsconfig.json'))
      const args = ['-p', tsconfigPath]
      if (options.watch) {
        args.push('--watch')
      }

            try {
        await new Promise((resolve, reject) => {
          const cmd = process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
          
          // 使用 shell: true 保证 Windows 下的环境变量和脚本能正常流转
          // 保持 stdio: 'pipe' 这样我们可以自己控制何时打印，但要实时消费它防止挂起
          const child = spawn(cmd, args, { 
            stdio: options.watch ? 'inherit' : 'pipe', 
            cwd: pluginDir,
            shell: process.platform === 'win32' // Windows 强开 shell 兼容
          })

          let hasError = false
          let pluginOutput = ''

          if (!options.watch) {
            // 实时收集标准输出
            child.stdout?.on('data', (data) => {
              const str = data.toString()
              pluginOutput += str
              // 如果 tsc 输出里包含了 "error"，标记有错误
              if (str.toLowerCase().includes('error TS')) {
                hasError = true
              }
            })

            // 实时收集错误输出
            child.stderr?.on('data', (data) => {
              pluginOutput += data.toString()
              hasError = true
            })
          } else {
            resolve(undefined)
            return
          }

          child.on('exit', (code: number) => {
            if (code === 0 && !hasError) {
              // 成功了，且没有潜藏的编译错误
              console.log(`${progressPrefix} ✅ Success: ${path.basename(pluginDir)} built.`)
              resolve(undefined)
            } else {
              // 失败了，一次性把这个插件的吐出来的错误全倒出来
              console.error(`\n${progressPrefix} ❌ tsc 编译失败 [${path.basename(pluginDir)}]，日志如下：\n`)
              console.error(pluginOutput || `进程异常退出，退出码: ${code}`)
              
              // 这里选择不 reject，让后面的插件能够继续编译
              resolve(undefined) 
            }
          })

          child.on('error', (err) => {
            console.error(`${progressPrefix} ❌ 无法启动 tsc 进程:`, err.message)
            resolve(undefined)
          })
        })
      } catch (err) {
        // 捕获可能存在的空指针
      }

    }
  })


cli.help()
cli.parse()
