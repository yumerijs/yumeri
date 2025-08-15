import { Core } from '@yumerijs/core'
import PluginLoader from '@yumerijs/loader'

export async function runMain() {
  const loader = new PluginLoader()
  const core = new Core(loader)

  try {
    await core.loadConfig('./config.yml')
    await core.loadPlugins()
    await core.runCore()
  } catch (err) {
    console.error('Application failed to start:', err)
    process.exit(1)
  }
}