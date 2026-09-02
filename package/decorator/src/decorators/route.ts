import type { Middleware } from '@yumerijs/core';
import { YUMERI_ROUTE_METADATA } from '../constants.js';
import type { RouteMetadata, RouteValueResolver } from '../metadata.js';

function getOwnRoutes(target: object): RouteMetadata[] {
  return Reflect.getOwnPropertyDescriptor(target, YUMERI_ROUTE_METADATA)?.value ?? [];
}

function defineRoutes(target: object, routes: RouteMetadata[]) {
  Object.defineProperty(target, YUMERI_ROUTE_METADATA, {
    value: routes,
    configurable: true,
    enumerable: false,
    writable: true,
  });
}

function upsertRouteMetadata(
  target: object,
  propertyKey: string | symbol,
  updater: (current: RouteMetadata | undefined) => RouteMetadata,
) {
  const routes = [...getOwnRoutes(target)];
  const index = routes.findIndex((route) => route.propertyKey === propertyKey);
  const current = index >= 0 ? routes[index] : undefined;
  const next = updater(current);

  if (index >= 0) {
    routes[index] = next;
  } else {
    routes.push(next);
  }

  defineRoutes(target, routes);
}

function normalizeMethods(methods: string | string[] | undefined): string[] {
  const list = Array.isArray(methods) ? methods : methods ? [methods] : ['GET'];
  return [...new Set(list.map((item) => item.toUpperCase()))];
}

export interface RouteOptions {
  method?: string | string[];
  middleware?: Middleware[];
  host?: RouteValueResolver<any, string | string[] | undefined>;
}

function defineRoute(path: RouteValueResolver<any, string>, options: RouteOptions = {}): MethodDecorator {
  return (target, propertyKey) => {
    upsertRouteMetadata(target, propertyKey, (current) => ({
      path,
      propertyKey,
      methods: normalizeMethods(options.method ?? current?.methods),
      middlewares: options.middleware ?? current?.middlewares,
      hosts: options.host ?? current?.hosts,
    }));
  };
}

function createMethodDecorator(method: string) {
  return (
    path: string | ((instance: any) => string),
    options: Omit<RouteOptions, 'method'> = {},
  ): MethodDecorator =>
    defineRoute(path, { ...options, method });
}

export const Get = createMethodDecorator('GET');
export const Post = createMethodDecorator('POST');
export const Put = createMethodDecorator('PUT');
export const Patch = createMethodDecorator('PATCH');
export const Delete = createMethodDecorator('DELETE');
export const Head = createMethodDecorator('HEAD');

export function Use(...middlewares: Middleware[]): MethodDecorator {
  return (target, propertyKey) => {
    upsertRouteMetadata(target, propertyKey, (current) => ({
      path: current?.path ?? '',
      propertyKey,
      methods: current?.methods ?? ['GET'],
      hosts: current?.hosts,
      middlewares: [...(current?.middlewares ?? []), ...middlewares],
    }));
  };
}

export function Host(
  host: string | string[] | ((instance: any) => string | string[] | undefined),
): MethodDecorator {
  return (target, propertyKey) => {
    upsertRouteMetadata(target, propertyKey, (current) => ({
      path: current?.path ?? '',
      propertyKey,
      methods: current?.methods ?? ['GET'],
      middlewares: current?.middlewares,
      hosts: host,
    }));
  };
}

export function getRouteMetadata(target: object): RouteMetadata[] {
  const routes: RouteMetadata[] = [];
  let current: object | null = target;

  while (current && current !== Object.prototype) {
    routes.unshift(...getOwnRoutes(current));
    current = Object.getPrototypeOf(current);
  }

  return routes.filter((route) => route.path);
}
