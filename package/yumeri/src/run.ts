import { Core } from '@yumerijs/core';
import PluginLoader from '@yumerijs/loader';

async function main() {
  const core = new Core();
  const loader = new PluginLoader();

  try {
    await core.loadConfig('./config.yml');
    await core.loadPlugins(loader);

    // ...
  } catch (err) {
    console.error('Application failed to start:', err);
  }
}

main();