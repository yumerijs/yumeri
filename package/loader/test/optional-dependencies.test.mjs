import assert from 'node:assert/strict';
import { Core } from '../../core/dist/index.js';
import { PluginLoader } from '../dist/index.js';

function service(name) {
  return class {
    constructor() {
      this.name = name;
    }
  };
}

async function load(modules, pluginIds) {
  const core = new Core(undefined, { skipcheckUpdates: true }, false, false);
  const loader = new PluginLoader(core);
  core.loader = loader;
  loader.config = {
    core: {},
    plugins: Object.fromEntries(pluginIds.map(id => [id, {}])),
  };
  loader.loadModule = async pluginName => modules[pluginName];
  await loader.loadPlugins();
  return loader;
}

const strictOrder = [];
const strictLoader = await load({
  B: {
    depend: ['A'],
    optional: ['C'],
    apply(ctx) {
      strictOrder.push('B');
      assert.ok(ctx.component.A, 'required service should be injected');
      assert.ok(ctx.component.C, 'available optional service should be injected');
    },
  },
  A: {
    provide: ['A'],
    apply(ctx) {
      strictOrder.push('A');
      ctx.registerService('A', service('A'));
    },
  },
  C: {
    provide: ['C'],
    apply(ctx) {
      strictOrder.push('C');
      ctx.registerService('C', service('C'));
    },
  },
}, ['B', 'A', 'C']);

assert.deepEqual(strictOrder, ['A', 'C', 'B']);
assert.equal(strictLoader.pluginStatus.B, 'enabled');

const relaxedOrder = [];
const relaxedLoader = await load({
  B: {
    depend: ['A'],
    optional: ['C'],
    apply(ctx) {
      relaxedOrder.push('B');
      assert.ok(ctx.component.A, 'required service should still be injected');
      assert.equal(ctx.component.C, undefined, 'missing optional service should not be injected');
    },
  },
  A: {
    provide: ['A'],
    apply(ctx) {
      relaxedOrder.push('A');
      ctx.registerService('A', service('A'));
    },
  },
}, ['B', 'A']);

assert.deepEqual(relaxedOrder, ['A', 'B']);
assert.equal(relaxedLoader.pluginStatus.B, 'enabled');

const unresolvedLoader = await load({
  B: {
    depend: ['missing-required-service'],
    optional: ['C'],
    apply() {
      throw new Error('plugin with a missing required service must not be applied');
    },
  },
}, ['B']);

assert.equal(unresolvedLoader.pluginStatus.B, 'pending');

console.log('optional dependency loader tests passed');
