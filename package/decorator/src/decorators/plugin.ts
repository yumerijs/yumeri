import type { Config, Context, Plugin as CorePlugin } from '@yumerijs/core';
import { getRouteMetadata } from './route.js';
import { getEventMetadata } from './event.js';
import { getHookMetadata } from './hook.js';
import { getInjectMetadata } from './inject.js';
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
    
    // 支持路由处理器返回值覆盖 session.body
    routeInstance.action(async (session: any, params: any, ...rest: any[]) => {
      const result = await handler.apply(instance, [session, params, ...rest]);
      if (result !== undefined) {
        session.body = result;
      }
    });

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

function registerDecoratedEvents(instance: any, ctx: PluginLikeContext) {
  const events = getEventMetadata(Object.getPrototypeOf(instance));
  for (const event of events) {
    const handler = instance[event.propertyKey];
    if (typeof handler === 'function') {
      ctx.on(event.event, handler.bind(instance));
    }
  }
}

function registerDecoratedHooks(instance: any, ctx: PluginLikeContext) {
  const hooks = getHookMetadata(Object.getPrototypeOf(instance));
  for (const hook of hooks) {
    const handler = instance[hook.propertyKey];
    if (typeof handler === 'function') {
      ctx.hook(hook.name, hook.hookname, handler.bind(instance));
    }
  }
}

function performInjections(instance: any, ctx: PluginLikeContext) {
  const injects = getInjectMetadata(Object.getPrototypeOf(instance));
  for (const inject of injects) {
    const component = ctx.component[inject.name];
    if (component) {
      instance[inject.propertyKey] = component;
    }
  }
}

/**
 * 插件类装饰器
 * 负责在插件实例化时自动处理依赖注入、路由注册、事件监听和钩子挂载
 */
export function Plugin<TBase extends Constructor>(Base: TBase) {
  return class DecoratedPlugin extends Base {
    constructor(...args: any[]) {
      super(...args);
      const [ctx] = args;
      
      // 如果构造函数第一个参数是 Context 且具备核心 API，则自动执行绑定
      if (ctx && typeof (ctx as any).route === 'function') {
        const pluginCtx = ctx as PluginLikeContext;
        performInjections(this, pluginCtx);
        registerDecoratedRoutes(this, pluginCtx);
        registerDecoratedEvents(this, pluginCtx);
        registerDecoratedHooks(this, pluginCtx);
      }
    }
  };
}
