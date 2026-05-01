import { YUMERI_INJECT_METADATA } from '../constants.js';
import type { InjectMetadata } from '../metadata.js';

function getOwnInjects(target: object): InjectMetadata[] {
  return Reflect.getOwnPropertyDescriptor(target, YUMERI_INJECT_METADATA)?.value ?? [];
}

function defineInjects(target: object, injects: InjectMetadata[]) {
  Object.defineProperty(target, YUMERI_INJECT_METADATA, {
    value: injects,
    configurable: true,
    enumerable: false,
    writable: true,
  });
}

export function Inject(name?: string): PropertyDecorator {
  return (target, propertyKey) => {
    const injects = getOwnInjects(target);
    injects.push({ name: name || String(propertyKey), propertyKey });
    defineInjects(target, injects);
  };
}

export function getInjectMetadata(target: object): InjectMetadata[] {
  const injects: InjectMetadata[] = [];
  let current: object | null = target;

  while (current && current !== Object.prototype) {
    injects.unshift(...getOwnInjects(current));
    current = Object.getPrototypeOf(current);
  }

  return injects;
}
