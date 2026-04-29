import PluginLoader from '@yumerijs/loader'
import { PluginStatus, fallback } from '@yumerijs/core'
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { pathToFileURL } from 'url'

function migrateConfig(yamlPath: string, jsonPath: string) {
  try {
    console.log('Found config.yml, migrating to yumeri.json...');
    const yamlContent = fs.readFileSync(yamlPath, 'utf8');
    const data = yaml.load(yamlContent);
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
    fs.renameSync(yamlPath, yamlPath + '.migrated');
    console.log('Successfully migrated config.yml to yumeri.json. The old file has been renamed to config.yml.migrated.');
  } catch (e) {
    console.error('An error occurred during config migration:', e);
    process.exit(1);
  }
}

export async function runMain() {
  try {
    const loader = new PluginLoader()

    const cwd = process.cwd()
    const jsonConfigPath = path.join(cwd, 'yumeri.json')
    const yamlConfigPath = path.join(cwd, 'config.yml')

    if (fs.existsSync(yamlConfigPath) && !fs.existsSync(jsonConfigPath)) {
      migrateConfig(yamlConfigPath, jsonConfigPath);
    }

    let configPathToLoad: string | null = null;

    if (fs.existsSync(jsonConfigPath)) {
      configPathToLoad = jsonConfigPath;
    } else if (fs.existsSync(yamlConfigPath)) {
      configPathToLoad = yamlConfigPath;
    }

    if (!configPathToLoad) {
      if (fs.existsSync(yamlConfigPath + '.migrated')) {
         console.error(`Configuration file 'yumeri.json' not found.`);
      } else {
         console.error('Configuration file (yumeri.json or config.yml) not found.');
      }
      process.exit(1);
    }
    
    await loader.loadConfig(configPathToLoad)

    await loader.loadPlugins()

    // 加载本地 APP 模块
    const appDir = process.argv[2] || 'dist'
    const appPath = path.resolve(cwd, appDir)
    const indexPath = path.join(appPath, 'index.js')

    if (fs.existsSync(indexPath)) {
      try {
        const appModule = await import(pathToFileURL(indexPath).href)
        const plugin = appModule.default || appModule
        const context = loader.getContext('app')
        
        const rawConfig = (loader.config.plugins && loader.config.plugins['app']) || {}
        const finalConfig = fallback(plugin.config, rawConfig)
        if (loader.config.plugins) loader.config.plugins['app'] = finalConfig

        await loader.getCore().plugin(plugin, context, finalConfig)
        loader.plugins['app'] = plugin
        loader.pluginStatus['app'] = PluginStatus.ENABLED
      } catch (e) {
        console.error(`Failed to load app plugin from ${appPath}:`, e)
      }
    }

    await loader.getCore().runCore()
    
  } catch (err) {
    console.error('Application failed to start:', err)
    process.exit(1)
  }
}
