/**
* @interface Database
* @description 定义了数据库操作的核心接口，为上层应用提供统一的数据库访问能力。
*              这个接口抽象了底层数据库的具体实现（如 MySQL），使得业务逻辑可以不依赖于特定的数据库驱动。
*/
export interface Database {
  /**
   * @method runSQL
   * @description 执行任意的 SQL 语句。通常用于非 SELECT 操作（如 INSERT, UPDATE, DELETE, DDL）。
   * @param {string} sql - 要执行的 SQL 字符串。
   * @param {any[]} [params=[]] - SQL 语句中的参数数组，用于占位符 (?) 替换，以防止 SQL 注入。
   * @returns {Promise<{ insertId?: number; affectedRows?: number }>} 一个 Promise，解析为一个对象，
   *          包含 `insertId`（如果执行 INSERT 操作）和 `affectedRows`（如果执行 UPDATE/DELETE 操作）。
   * @throws {Error} 如果 SQL 执行失败，抛出错误。
   */
  runSQL(sql: string, params?: any[]): Promise<{ insertId?: number; affectedRows?: number }>;

  /**
   * @method all
   * @description 执行 SQL 查询，并返回所有匹配的结果行。
   * @param {string} sql - 要执行的 SELECT SQL 字符串。
   * @param {any[]} [params=[]] - SQL 语句中的参数数组。
   * @returns {Promise<any[]>} 一个 Promise，解析为一个包含所有结果行的数组。
   * @throws {Error} 如果查询失败，抛出错误。
   */
  all(sql: string, params?: any[]): Promise<any[]>;

  /**
   * @method get
   * @description 执行 SQL 查询，并返回第一个匹配的结果行。如果没有匹配的行，则返回 `undefined`。
   * @param {string} sql - 要执行的 SELECT SQL 字符串。
   * @param {any[]} [params=[]] - SQL 语句中的参数数组。
   * @returns {Promise<any | undefined>} 一个 Promise，解析为第一个结果行，或者 `undefined`。
   * @throws {Error} 如果查询失败，抛出错误。
   */
  get(sql: string, params?: any[]): Promise<any | undefined>;

  /**
   * @method insert
   * @description 向指定表中插入一条新数据。
   * @param {string} tableName - 要插入数据的表名。
   * @param {Record<string, any>} data - 包含要插入的列名和对应值的对象。
   * @returns {Promise<number>} 一个 Promise，解析为新插入行的 ID (`insertId`)。如果插入失败或没有 ID，则返回 0。
   * @throws {Error} 如果插入操作失败，抛出错误。
   */
  insert(tableName: string, data: Record<string, any>): Promise<number>;

  /**
   * @method batchInsert
   * @description 批量向指定表中插入多条数据，支持事务处理以确保原子性。
   * @param {string} tableName - 要插入数据的表名。
   * @param {Record<string, any>[]} dataArray - 包含多个要插入的数据对象的数组。
   * @returns {Promise<void>} 一个 Promise，在所有数据成功插入并提交事务后解析，或在事务回滚后拒绝。
   * @throws {Error} 如果批量插入操作失败或事务回滚，抛出错误。
   */
  batchInsert(tableName: string, dataArray: Record<string, any>[]): Promise<void>;

  /**
   * @method update
   * @description 更新指定表中匹配条件的数据。
   * @param {string} tableName - 要更新数据的表名。
   * @param {Record<string, any>} data - 包含要更新的列名和新值的对象。
   * @param {QueryConditions} conditions - 定义要更新的行所必须满足的条件。支持复杂查询操作符。
   * @returns {Promise<number>} 一个 Promise，解析为受影响的行数。
   * @throws {Error} 如果更新操作失败，抛出错误。
   */
  update(tableName: string, data: Record<string, any>, conditions: QueryConditions): Promise<number>;

  /**
   * @method delete
   * @description 从指定表中删除匹配条件的数据。
   * @param {string} tableName - 要删除数据的表名。
   * @param {QueryConditions} conditions - 定义要删除的行所必须满足的条件。支持复杂查询操作符。
   * @returns {Promise<number>} 一个 Promise，解析为受影响的行数。
   * @throws {Error} 如果删除操作失败，抛出错误。
   */
  delete(tableName: string, conditions: QueryConditions): Promise<number>;

  /**
   * @method find
   * @description 从指定表中查找匹配条件的数据列表，支持高级查询选项（如选择列、排序、分页、分组）。
   * @param {string} tableName - 要查询的表名。
   * @param {QueryConditions} [conditions={}] - 定义查询条件的键值对或复杂操作符。
   * @param {FindOptions} [options={}] - 查询选项，包括 `select`、`limit`、`offset`、`orderBy`、`groupBy`、`having`。
   * @returns {Promise<any[]>} 一个 Promise，解析为匹配条件的结果行数组。
   * @throws {Error} 如果查询失败，抛出错误。
   */
  find(tableName: string, conditions?: QueryConditions, options?: FindOptions): Promise<any[]>;

  /**
   * @method findOne
   * @description 从指定表中查找匹配条件的单个记录。这相当于 `find` 方法并设置 `limit: 1`。
   * @param {string} tableName - 要查询的表名。
   * @param {QueryConditions} [conditions={}] - 定义查询条件的键值对或复杂操作符。
   * @param {FindOptions} [options={}] - 额外查询选项，通常会忽略 `limit`。
   * @returns {Promise<any | undefined>} 一个 Promise，解析为匹配的单个记录，如果未找到则为 `undefined`。
   * @throws {Error} 如果查询失败，抛出错误。
   */
  findOne(tableName: string, conditions?: QueryConditions, options?: FindOptions): Promise<any | undefined>;

  /**
   * @method close
   * @description 关闭数据库连接池，释放所有资源。
   * @returns {Promise<void>} 一个 Promise，解析表示连接池已关闭。
   * @throws {Error} 如果关闭操作失败，抛出错误。
   */
  close(): Promise<void>;

  /**
   * @method createTable
   * @description 根据提供的 Schema 创建一个数据库表。如果表已存在，则不会重复创建。
   * @param {string} tableName - 要创建的表名。
   * @param {TableSchema} schema - 定义表结构的对象，包含列名和列定义。
   * @returns {Promise<void>} 一个 Promise，表示表创建成功或已存在。
   * @throws {Error} 如果表创建失败，抛出错误。
   */
  createTable(tableName: string, schema: TableSchema): Promise<void>;

  /**
   * @method updateTableStructure
   * @description 更新现有表的结构，支持添加、修改和删除列。
   * @param {string} tableName - 要更新结构的表名。
   * @param {ColumnAlteration[]} alterations - 描述要对表进行的结构变更的数组。
   * @returns {Promise<void>} 一个 Promise，表示表结构更新成功。
   * @throws {Error} 如果表结构更新失败，抛出错误。
   */
  updateTableStructure(tableName: string, alterations: ColumnAlteration[]): Promise<void>;

  /**
   * @method tableExists
   * @description 检查指定名称的表是否在数据库中存在。
   * @param {string} tableName - 要检查的表名。
   * @returns {Promise<boolean>} 一个 Promise，解析为 `true` 如果表存在，`false` 如果表不存在。
   * @throws {Error} 如果检查操作失败，抛出错误。
   */
  tableExists(tableName: string): Promise<boolean>;
}

// 在你的 MysqlDatabase 类中实现这个接口:
// export class MysqlDatabase implements IDatabase { ... }
/**
 * 表结构定义
 */
export interface ColumnDefinition {
  type: ColumnType | 'string' | 'number' | 'boolean'; // 允许使用更友好的类型名称，在 buildColumnSQL 中映射
  length?: number; // 长度，例如 VARCHAR(255)
  precision?: number; // 精度，例如 DECIMAL(10,2)
  scale?: number; // 小数位数
  primaryKey?: boolean;
  autoIncrement?: boolean;
  notNull?: boolean;
  unique?: boolean;
  default?: any | 'CURRENT_TIMESTAMP_FUNC'; // 'CURRENT_TIMESTAMP_FUNC' 是特殊标记
  onUpdate?: 'CURRENT_TIMESTAMP_FUNC'; // 仅用于 TIMESTAMP/DATETIME
  unsigned?: boolean; // 仅用于数值类型
  zerofill?: boolean; // 仅用于数值类型
  comment?: string; // 列注释
  enum?: string[]; // ENUM 类型的值
}

export type TableSchema = Record<string, ColumnDefinition>;

export type ColumnType =
  | 'TINYINT'
  | 'SMALLINT'
  | 'MEDIUMINT'
  | 'INT'
  | 'BIGINT'
  | 'FLOAT'
  | 'DOUBLE'
  | 'DECIMAL'
  | 'BOOLEAN' // 会映射到 TINYINT(1)
  | 'DATE'
  | 'TIME'
  | 'DATETIME'
  | 'TIMESTAMP'
  | 'YEAR'
  | 'CHAR'
  | 'VARCHAR'
  | 'TINYTEXT'
  | 'TEXT'
  | 'MEDIUMTEXT'
  | 'LONGTEXT'
  | 'TINYBLOB'
  | 'BLOB'
  | 'MEDIUMBLOB'
  | 'LONGBLOB'
  | 'JSON'
  | 'ENUM'; // 可以根据需要扩展
export interface QueryConditions {
  [key: string]: ConditionValue | QueryConditions | QueryOperator;
}
export type ConditionValue = string | number | boolean | null | Date | (string | number | boolean | null | Date)[];
export interface QueryOperator {
  $eq?: ConditionValue; // 等于
  $ne?: ConditionValue; // 不等于
  $gt?: ConditionValue; // 大于
  $gte?: ConditionValue; // 大于等于
  $lt?: ConditionValue; // 小于
  $lte?: ConditionValue; // 小于等于
  $in?: ConditionValue[]; // IN 列表
  $nin?: ConditionValue[]; // NOT IN 列表
  $like?: string; // LIKE
  $notLike?: string; // NOT LIKE
  $between?: [ConditionValue, ConditionValue]; // BETWEEN 范围
  $notBetween?: [ConditionValue, ConditionValue]; // NOT BETWEEN 范围
  $isNull?: boolean; // IS NULL / IS NOT NULL
  $notNull?: boolean; // IS NOT NULL
  $or?: QueryConditions[]; // OR 组合
  $and?: QueryConditions[]; // AND 组合 (通常隐式存在)
}
export interface ColumnAlteration {
  action: AlterColumnAction;
  field: string;
  definition?: ColumnDefinition; // for ADD/MODIFY
  oldFieldName?: string; // for CHANGE / RENAME (not implemented directly here, but conceptually)
}
export type OrderByType = 'ASC' | 'DESC';

export interface OrderByOption {
  field: string;
  direction?: OrderByType;
}

export interface FindOptions {
  select?: string[]; // 选择的列
  limit?: number;
  offset?: number;
  orderBy?: string | OrderByOption | (string | OrderByOption)[];
  groupBy?: string | string[];
  having?: string; // Having 子句，目前只支持原始字符串，复杂Having建议直接写SQL
}

// updateTableStructure 用于 ALTER TABLE 的类型
export type AlterColumnAction = 'ADD' | 'MODIFY' | 'DROP';
