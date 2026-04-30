import type { Middleware } from '@yumerijs/core';

export type RouteValueResolver<T = any, TValue = string | string[] | undefined> = TValue | ((instance: T) => TValue);

export interface RouteMetadata {
  path: RouteValueResolver<any, string>;
  methods: string[];
  propertyKey: string | symbol;
  middlewares?: Middleware[];
  hosts?: RouteValueResolver<any, string[] | string | undefined>;
}

export interface PluginLikeContext {
  route(path: string): {
    action(handler: (...args: any[]) => any): any;
    use?(middleware: Middleware): any;
    host?(host: string[] | string): any;
    allowedMethods?: string[];
  };
}
