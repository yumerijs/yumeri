/**
 * A mapping from table names to their data types for type inference.
 * Extend this interface via declaration merging in your plugins.
 * 
 * @example
 * declare module '@yumerijs/types' {
 *   interface Tables {
 *     schedule: Schedule
 *   }
 * }
 */
export interface Tables { }

// --- Schema Definition ---

export type FieldType = 'string' | 'text' | 'json' | 'integer' | 'unsigned' | 'bigint' | 'float' | 'double' | 'decimal' | 'boolean' | 'date' | 'time' | 'timestamp';

export interface FieldDefinition {
  type: FieldType;
  length?: number;
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

// --- Query Definition ---

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

// --- Main Database Interface ---

export interface Database {
  /**
   * Extends the database schema with a new table or new fields.
   * @param table The name of the table to extend.
   * @param schema The schema definition for the fields.
   * @param indexes Optional index definitions for the table.
   */
  extend<K extends keyof Tables>(table: K, schema: Schema<Partial<Tables[K]>>, indexes?: IndexDefinition<Tables[K]>): Promise<void>;

  /**
   * Creates a new record in the table.
   * @param table The name of the table.
   * @param data The data for the new record.
   */
  create<K extends keyof Tables>(table: K, data: Partial<Tables[K]>): Promise<Tables[K]>;

  /**
   * Retrieves records from the table.
   * @param table The name of the table.
   * @param query The query conditions.
   * @param fields An optional array of fields to select.
   */
  select<K extends keyof Tables, F extends keyof Tables[K]>(table: K, query: Query<Tables[K]>, fields?: F[]): Promise<Pick<Tables[K], F>[]>;

  /**
   * Retrieves a single record from the table.
   * @param table The name of the table.
   * @param query The query conditions.
   * @param fields An optional array of fields to select.
   */
  selectOne<K extends keyof Tables, F extends keyof Tables[K]>(table: K, query: Query<Tables[K]>, fields?: F[]): Promise<Pick<Tables[K], F> | undefined>;

  /**
   * Updates records in the table.
   * @param table The name of the table.
   * @param query The query conditions to select records for update.
   * @param data The data to update.
   */
  update<K extends keyof Tables>(table: K, query: Query<Tables[K]>, data: Partial<Tables[K]>): Promise<number>;

  /**
   * Removes records from the table.
   * @param table The name of the table.
   * @param query The query conditions to select records for removal.
   */
  remove<K extends keyof Tables>(table: K, query: Query<Tables[K]>): Promise<number>;

  /**
   * Creates or updates records in the table.
   * @param table The name of the table.
   * @param data An array of records to upsert.
   * @param key The field(s) to use as the unique key for conflict resolution.
   */
  upsert<K extends keyof Tables>(table: K, data: Partial<Tables[K]>[], key: keyof Tables[K] | (keyof Tables[K])[]): Promise<void>;

  /**
   * Drops a table from the database.
   * @param table The name of the table to drop.
   */
  drop<K extends keyof Tables>(table: K): Promise<void>;

  /**
   * Executes a raw SQL command (INSERT, UPDATE, DELETE).
   */
  run(sql: string, params?: any[]): Promise<any>;

  /**
   * Executes a raw SQL query and returns a single row.
   */
  get(sql: string, params?: any[]): Promise<any>;

  /**
   * Executes a raw SQL query and returns all rows.
   */
  all(sql: string, params?: any[]): Promise<any[]>;

  /**
   * Closes the database connection.
   */
  close(): Promise<void>;
}