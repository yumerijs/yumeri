import PluginLoader from '@yumerijs/loader'

export async function runMain() {
  try {
    // 1. Create a PluginLoader instance.
    const loader = new PluginLoader()

    // 2. Load the configuration using the loader.
    await loader.loadConfig('./config.yml')

    // 3. Load the plugins using the loader.
    await loader.loadPlugins()

    // 4. Get the core instance from the loader and run it.
    await loader.getCore().runCore()
    
  } catch (err) {
    console.error('Application failed to start:', err)
    process.exit(1)
  }
}
