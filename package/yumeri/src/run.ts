import { Core } from '@yumerijs/core';
import PluginLoader from '@yumerijs/loader';

async function main() {
  const loader = new PluginLoader();
  const core = new Core(loader);

  try {
    await core.loadConfig('./config.yml');
    await core.loadPlugins();

    // ...
  } catch (err) {
    console.error('Application failed to start:', err);
  }
}

main();