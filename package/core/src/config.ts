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
  defaultValue?: any;
  properties?: Record<string, Schema<any>>;
  items?: Schema<any>;
  enum?: T[];

  constructor(definition: Omit<Schema<T>, '_type' | 'required' | 'default'> & { enum?: T[] }) {
    this.type = definition.type;
    this.isRequired = (definition as any).isRequired;
    this.description = definition.description;
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
  
  default(this: this, value: T): this {
    this.defaultValue = value;
    return this;
  }
}

export { Schema as ConfigSchema }

export interface Config {
  [key: string]: any
}