import type { I18n } from './i18n.js';

function isNullable(value: any) {
  return value === null || value === undefined
}

export function fallback<T>(schema: Schema<T>, config: T): T {
  if (!schema) return config;

  let result = config;
  if (isNullable(result)) {
    result = schema.defaultValue;
  }

  if (schema.type === 'object') {
    if (typeof result !== 'object' || result === null) {
      result = {} as T;
    }
    for (const key in schema.properties) {
      const innerSchema = schema.properties[key];
      (result as any)[key] = fallback(innerSchema, (result as any)[key]);
    }
  } else if (schema.type === 'array' && schema.items) {
    if (!Array.isArray(result)) {
      result = [] as any;
    }
    result = (result as any[]).map((item: any) => fallback(schema.items!, item)) as any;
  }
  return result;
}

export class Schema<T = any> {
  _type?: T; // Phantom type
  type: string;
  isRequired?: boolean;
  description?: string;
  /** 说明文字对应的 i18n key，由 key() 设置 */
  i18nKey?: string;
  defaultValue?: any;
  properties?: Record<string, Schema<any>>;
  items?: Schema<any>;
  enum?: T[];

  constructor(definition: Omit<Schema<T>, '_type' | 'required' | 'default' | 'key'> & { enum?: T[] }) {
    this.type = definition.type;
    this.isRequired = (definition as any).isRequired;
    this.description = definition.description;
    this.i18nKey = definition.i18nKey;
    this.defaultValue = (definition as any).defaultValue;
    this.properties = definition.properties;
    this.items = definition.items;
    this.enum = definition.enum;
  }

  static string(description?: string): Schema<string> {
    return new Schema({ type: 'string', description });
  }

  static number(description?: string): Schema<number> {
    return new Schema({ type: 'number', description });
  }

  static boolean(description?: string): Schema<boolean> {
    return new Schema({ type: 'boolean', description });
  }

  static array<T>(inner: Schema<T>, description?: string): Schema<T[]> {
    return new Schema({ type: 'array', items: inner, description });
  }

  static object<T extends {}>(properties: { [K in keyof T]: Schema<T[K]> }, description?: string): Schema<T> {
    return new Schema({ type: 'object', properties, description });
  }

  static extend<T extends {}, U extends {}>(base: Schema<T>, extension: { [K in keyof U]: Schema<U[K]> }, description?: string): Schema<T & U> {
    const combinedProperties = { ...base.properties, ...extension } as { [K in keyof (T & U)]: Schema<(T & U)[K]> };
    return new Schema({ type: 'object', properties: combinedProperties, description: description || base.description });
  }

  static enum<L extends string | number>(values: L[], description?: string): Schema<L> {
    const type = typeof values[0] === 'string' ? 'string' : typeof values[0] === 'number' ? 'number' : 'string'; // Infer type based on first value
    return new Schema({ type, enum: values, description });
  }

  required(this: this): this {
    this.isRequired = true;
    return this;
  }

  /**
   * 绑定说明文字的 i18n key
   *
   * 绑定后该配置项的说明文字会按请求语言从内置 I18n 里解析；
   * key 未注册或没命中任何语言时，仍然显示 description 原文，
   * 所以不接入 i18n 的插件不受影响。
   *
   * @param name 翻译 key，建议用 `插件名.config.配置项` 形式的命名空间避免全局撞车
   */
  key(name: string): this {
    this.i18nKey = name;
    return this;
  }

  default(this: this, value: T): this {
    this.defaultValue = value;
    return this;
  }
}

/**
 * 解析 schema 说明文字要显示的文本
 *
 * 没绑定 i18n key、或 key 没有命中任何语言时一律退回 description 原文，
 * 因此插件的显示效果在未接入 i18n 时与之前完全一致。
 * 绑定了 key 的配置项可以不写 description，此时直接使用译文；
 * 译文和原文都没有时返回 undefined，由调用方回落到字段名。
 *
 * @param schema schema 节点
 * @param i18n i18n 实例，未初始化时按原文处理
 * @param langs 语言优先级列表，通常是 session.request.languages
 */
export function resolveDescription(schema: Schema<any>, i18n?: I18n, langs?: string[]): string | undefined {
  if (!schema) return undefined;

  const key = schema.i18nKey;
  if (key && i18n) {
    const translated = i18n.get(key, langs);
    // I18n.get 在没命中任何语言时会原样返回 key，借此判断是否真的翻译到了
    if (translated !== key) return translated;
  }

  return schema.description;
}

export { Schema as ConfigSchema }

export interface Config {
  [key: string]: any
}