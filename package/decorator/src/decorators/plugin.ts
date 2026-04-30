import type { Config, Context, Plugin as CorePlugin } from '@yumerijs/core';
import { getRouteMetadata } from './route.js';
import type { PluginLikeContext, RouteValueResolver } from '../metadata.js';

type Constructor<T = object> = new (...args: any[]) => T;

function resolveValue<TValue>(instance: any, value: RouteValueResolver<any, TValue>): TValue {
  return typeof value === 'function' ? (value as (instance: any) => TValue)(instance) : value;
}

function registerDecoratedRoutes(instance: any, ctx: PluginLikeContext) {
  const routes = getRouteMetadata(Object.getPrototypeOf(instance));

  for (const route of routes) {
    const handler = instance[route.propertyKey];
    if (typeof handler !== 'function') {
      throw new TypeError(`Decorated route "${String(route.propertyKey)}" is not a method.`);
    }

    const path = resolveValue(instance, route.path);
    const routeInstance = ctx.route(path);
    routeInstance.action(handler.bind(instance));

    if (Array.isArray(routeInstance.allowedMethods) && route.methods.length > 0) {
      routeInstance.allowedMethods = route.methods;
    }

    for (const middleware of route.middlewares ?? []) {
      routeInstance.use?.(middleware);
    }

    if (route.hosts) {
      const hosts = resolveValue(instance, route.hosts);
      const normalizedHosts = Array.isArray(hosts) ? hosts.filter(Boolean) : hosts ? [hosts] : [];
      if (normalizedHosts.length > 0) {
        routeInstance.host?.(normalizedHosts);
      }
    }
  }
}

export function Plugin<TBase extends Constructor>(Base: TBase) {
  return class DecoratedPlugin extends Base implements CorePlugin {
    constructor(...args: any[]) {
      super(...args);
      const [ctx] = args;
      if (ctx && typeof (ctx as PluginLikeContext).route === 'function') {
        registerDecoratedRoutes(this, ctx as PluginLikeContext);
      }
    }
  };
}
