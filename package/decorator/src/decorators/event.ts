import { YUMERI_EVENT_METADATA } from '../constants.js';
import type { EventMetadata } from '../metadata.js';

function getOwnEvents(target: object): EventMetadata[] {
  return Reflect.getOwnPropertyDescriptor(target, YUMERI_EVENT_METADATA)?.value ?? [];
}

function defineEvents(target: object, events: EventMetadata[]) {
  Object.defineProperty(target, YUMERI_EVENT_METADATA, {
    value: events,
    configurable: true,
    enumerable: false,
    writable: true,
  });
}

export function On(event: string): MethodDecorator {
  return (target, propertyKey) => {
    const events = getOwnEvents(target);
    events.push({ event, propertyKey });
    defineEvents(target, events);
  };
}

export function getEventMetadata(target: object): EventMetadata[] {
  const events: EventMetadata[] = [];
  let current: object | null = target;

  while (current && current !== Object.prototype) {
    events.unshift(...getOwnEvents(current));
    current = Object.getPrototypeOf(current);
  }

  return events;
}
