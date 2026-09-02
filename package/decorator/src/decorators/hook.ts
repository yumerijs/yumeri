import { YUMERI_HOOK_METADATA } from '../constants.js';
import type { HookMetadata } from '../metadata.js';

function getOwnHooks(target: object): HookMetadata[] {
  return Reflect.getOwnPropertyDescriptor(target, YUMERI_HOOK_METADATA)?.value ?? [];
}

function defineHooks(target: object, hooks: HookMetadata[]) {
  Object.defineProperty(target, YUMERI_HOOK_METADATA, {
    value: hooks,
    configurable: true,
    enumerable: false,
    writable: true,
  });
}

export function Hook(name: string, hookname: string): MethodDecorator {
  return (target, propertyKey) => {
    const hooks = getOwnHooks(target);
    hooks.push({ name, hookname, propertyKey });
    defineHooks(target, hooks);
  };
}

export function getHookMetadata(target: object): HookMetadata[] {
  const hooks: HookMetadata[] = [];
  let current: object | null = target;

  while (current && current !== Object.prototype) {
    hooks.unshift(...getOwnHooks(current));
    current = Object.getPrototypeOf(current);
  }

  return hooks;
}
