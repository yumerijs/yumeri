import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import fs from 'fs'
import { build as esbuild } from 'esbuild'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import crypto from 'crypto'

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'))
const projectRoot = __dirname
const distDir = path.resolve(projectRoot, 'dist')
const clientDir = path.resolve(distDir, 'client')
const manifestName = 'ui-manifest.json'
const manifestPrefix = `/__yumeri_vue_prebuilt/${pkg.name}`

export default defineConfig({
  plugins: [
    vue(),
    clientPrebundlePlugin()
  ],
  
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      formats: ['cjs', 'es'],
      fileName: (format) => `index.${format}.js`
    },
    
    rollupOptions: {
      external: [
        'yumeri',
        'vue',
      ],
      
      output: {
        globals: {
          'vue': 'Vue', 
          'yumeri': 'yumeri',
        }
      }
    }
  }
});

function clientPrebundlePlugin() {
  return {
    name: 'yumeri-ui-client-prebundle',
    async closeBundle() {
      const vueFiles = await collectVueFiles(path.resolve(projectRoot, 'src'))
      if (!vueFiles.length) return

      await fs.promises.mkdir(clientDir, { recursive: true })
      const manifest = {}

      for (const file of vueFiles) {
        const { outPath, publicPath } = await buildClientEntry(file)
        const rel = toPosix(path.relative(projectRoot, file))
        manifest[rel] = {
          entry: publicPath,
          file: toPosix(path.relative(distDir, outPath)),
        }
      }

      await fs.promises.writeFile(
        path.join(distDir, manifestName),
        JSON.stringify({ plugin: pkg.name, entries: manifest }, null, 2),
        'utf8'
      )
    }
  }
}

async function buildClientEntry(vueFile) {
  const stat = await fs.promises.stat(vueFile)
  const hash = crypto.createHash('md5').update(`${vueFile}:${stat.mtimeMs}`).digest('hex').slice(0, 8)
  const base = path.basename(vueFile, path.extname(vueFile))
  const outFile = path.join(clientDir, `${base}-${hash}.js`)
  const publicPath = `${manifestPrefix}/${path.basename(outFile)}`

  const entry = `
    import { createApp } from 'vue';
    import Component from ${JSON.stringify(vueFile)};
    const target = document.getElementById('app');
    const state = window.__INITIAL_STATE__ || {};
    if (target) {
      const app = createApp(Component, state);
      app.mount(target);
    }
  `

  await esbuild({
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2018',
    sourcemap: false,
    write: true,
    outfile: outFile,
    absWorkingDir: projectRoot,
    stdin: {
      contents: entry,
      sourcefile: 'entry-client.js',
      resolveDir: projectRoot,
      loader: 'ts',
    },
    plugins: [vueComponentPlugin()],
    loader: {
      '.ts': 'ts',
      '.tsx': 'tsx',
      '.js': 'js',
      '.jsx': 'jsx',
    },
  })

  return { outPath: outFile, publicPath }
}

function vueComponentPlugin() {
  return {
    name: 'yumeri-vue-sfc-client',
    setup(build) {
      build.onLoad({ filter: /\.vue$/ }, async (args) => {
        const source = await fs.promises.readFile(args.path, 'utf8')
        const { descriptor } = parse(source, { filename: args.path })
        const id = getScopeId(args.path)

        let contents = ''
        const lang = descriptor.scriptSetup?.lang || descriptor.script?.lang

        if (descriptor.script || descriptor.scriptSetup) {
          const compiled = compileScript(descriptor, {
            id,
            inlineTemplate: true,
            templateOptions: { ssr: false },
          })
          contents = compiled.content
        } else if (descriptor.template) {
          const templateResult = compileTemplate({
            id,
            filename: args.path,
            source: descriptor.template.content,
            ssr: false,
          })
          contents = `
import { defineComponent } from 'vue';
${templateResult.code}
export default defineComponent({ render });
`
        } else {
          contents = 'export default {};';
        }

        const css = await compileStyles(descriptor, args.path, id)
        if (css.trim().length > 0) {
          const styleId = `yumeri-vue-style-${id}`;
          contents += `
if (typeof document !== 'undefined' && !document.getElementById('${styleId}')) {
  const style = document.createElement('style');
  style.id = '${styleId}';
  style.textContent = ${JSON.stringify(css)};
  document.head.appendChild(style);
}
`;
        }

        return {
          contents,
          loader: inferLoader(lang),
          resolveDir: path.dirname(args.path),
        };
      });
    },
  };
}

async function compileStyles(descriptor, filename, id) {
  let css = ''
  for (const style of descriptor.styles) {
    const result = compileStyle({
      id,
      filename,
      source: style.content,
      scoped: style.scoped,
      preprocessLang: style.lang,
    })
    if (result.errors?.length) {
      console.error('[yumeri][vue-client-build] style compile error:', result.errors)
    }
    if (result.code) {
      css += result.code
    }
  }
  return css
}

async function collectVueFiles(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectVueFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.vue')) {
      files.push(full)
    }
  }
  return files
}

function inferLoader(lang) {
  switch (lang) {
    case 'ts': return 'ts'
    case 'tsx': return 'tsx'
    case 'jsx': return 'jsx'
    default: return 'js'
  }
}

function getScopeId(filename) {
  return crypto.createHash('md5').update(filename).digest('hex').slice(0, 8);
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}
