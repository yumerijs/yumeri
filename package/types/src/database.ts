
/**
 * A mapping from table names to their data types for type inference.
 * Extend this interface via declaration merging in your plugins.
 */
export interface Tables { }

// --- Schema Definition ---

export type FieldType = 'string' | 'text' | 'json' | 'integer' | 'unsigned' | 'bigint' | 'float' | 'double' | 'decimal' | 'boolean' | 'date' | 'time' | 'timestamp';

export interface FieldDefinition {
  type: FieldType;
  length?: number;
  precision?: number;
  scale?: number;
  autoIncrement?: boolean;
  initial?: any;
  nullable?: boolean;
  legacy?: string[];
}

export type Schema<T> = {
  [K in keyof T]?: FieldType | FieldDefinition;
} & {
  [key: string]: FieldType | FieldDefinition;
};

export interface IndexDefinition<T> {
  primary?: keyof T | (keyof T)[];
  autoInc?: boolean;
  unique?: (keyof T | (keyof T)[])[];
  foreign?: { [K in keyof T]?: [keyof Tables, string] };
}

// --- Query & Update Definition ---

export type Scalar = string | number | boolean | Date | null;

export interface Operator<T> {
  $eq?: T;
  $ne?: T;
  $gt?: T;
  $gte?: T;
  $lt?: T;
  $lte?: T;
  $in?: T[];
  $nin?: T[];
}

export type Query<T = any> = {
  [K in keyof T]?: T[K] | Operator<T[K]>;
} & {
  $or?: Query<T>[];
  $and?: Query<T>[];
};

export type UpdateData<T> = {
  [K in keyof T]?: T[K] | { $inc: number };
};

// --- Main Database Interface ---

export interface Database {
  extend<K extends keyof Tables>(table: K, schema: Schema<Partial<Tables[K]>>, indexes?: IndexDefinition<Tables[K]>): Promise<void>;

  create<K extends keyof Tables>(table: K, data: Partial<Tables[K]>): Promise<Tables[K]>;

  select<K extends keyof Tables, F extends keyof Tables[K]>(table: K, query: Query<Tables[K]>, fields?: F[]): Promise<Pick<Tables[K], F>[]>;

  selectOne<K extends keyof Tables, F extends keyof Tables[K]>(table: K, query: Query<Tables[K]>, fields?: F[]): Promise<Pick<Tables[K], F> | undefined>;

  update<K extends keyof Tables>(table: K, query: Query<Tables[K]>, data: UpdateData<Partial<Tables[K]>>): Promise<number>;

  remove<K extends keyof Tables>(table: K, query: Query<Tables[K]>): Promise<number>;

  /**
   * Creates or updates records in the table.
   * @param table The name of the table.
   * @param data The data to be inserted or used for updates.
   * @param key The field(s) to use as the unique key for conflict resolution.
   * @param update The update logic to apply on conflict. If not provided, it updates using the `data` payload.
   */
  upsert<K extends keyof Tables>(table: K, data: Partial<Tables[K]>[], key: keyof Tables[K] | (keyof Tables[K])[], update?: UpdateData<Partial<Tables[K]>>): Promise<void>;

  drop<K extends keyof Tables>(table: K): Promise<void>;

  run(sql: string, params?: any[]): Promise<any>;
  get(sql: string, params?: any[]): Promise<any>;
  all(sql: string, params?: any[]): Promise<any[]>;
  close(): Promise<void>;
}
