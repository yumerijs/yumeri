import type { Middleware, HookHandler } from '@yumerijs/core';

export type RouteValueResolver<T = any, TValue = string | string[] | undefined> = TValue | ((instance: T) => TValue);

export interface RouteMetadata {
  path: RouteValueResolver<any, string>;
  methods: string[];
  propertyKey: string | symbol;
  middlewares?: Middleware[];
  hosts?: RouteValueResolver<any, string[] | string | undefined>;
}

export interface EventMetadata {
  event: string;
  propertyKey: string | symbol;
}

export interface HookMetadata {
  name: string;
  hookname: string;
  propertyKey: string | symbol;
}

export interface InjectMetadata {
  name: string;
  propertyKey: string | symbol;
}

export interface PluginLikeContext {
  route(path: string): {
    action(handler: (...args: any[]) => any): any;
    use?(middleware: Middleware): any;
    host?(host: string[] | string): any;
    allowedMethods?: string[];
  };
  on(event: string, listener: (...args: any[]) => Promise<void> | void): void;
  hook(name: string, hookname: string, callback: HookHandler): void;
  component: Record<string, any>;
}
