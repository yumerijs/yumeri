/**
 * 通用数据库接口定义。
 */
export interface Database {
  /**
   * 执行任意 SQL 语句（通常用于 INSERT、UPDATE、DELETE）
   * @param sql SQL 语句
   * @param params 可选的参数数组
   * @returns 包含 insertId 和 affectedRows 的结果
   */
  runSQL(sql: string, params?: any[]): Promise<{ insertId?: number; affectedRows?: number }>;

  /**
   * 执行查询并返回所有结果
   * @param sql SQL 查询语句
   * @param params 可选参数
   * @returns 查询结果数组
   */
  all(sql: string, params?: any[]): Promise<any[]>;

  /**
   * 执行查询并返回第一条记录
   * @param sql SQL 查询语句
   * @param params 可选参数
   * @returns 查询结果中的第一条数据，或者 undefined
   */
  get(sql: string, params?: any[]): Promise<any | undefined>;

  /**
   * 插入一条记录
   * @param tableName 表名
   * @param data 要插入的数据对象
   * @returns 新插入记录的 ID
   */
  insert(tableName: string, data: Record<string, any>): Promise<number>;

  /**
   * 批量插入多条记录（使用事务）
   * @param tableName 表名
   * @param dataArray 多条数据组成的数组
   */
  batchInsert(tableName: string, dataArray: Record<string, any>[]): Promise<void>;

  /**
   * 更新指定记录
   * @param tableName 表名
   * @param data 要更新的字段和值
   * @param conditions 更新的条件（WHERE 子句）
   */
  update(tableName: string, data: Record<string, any>, conditions: Record<string, any>): Promise<void>;

  /**
   * 删除记录
   * @param tableName 表名
   * @param conditions 删除条件（WHERE 子句）
   */
  delete(tableName: string, conditions: Record<string, any>): Promise<void>;

  /**
   * 查询符合条件的所有记录
   * @param tableName 表名
   * @param conditions 查询条件（可选）
   * @param options 额外选项如 orderBy, limit, offset
   * @returns 结果数组
   */
  find(tableName: string, conditions?: Record<string, any>, options?: any): Promise<any[]>;

  /**
   * 查询符合条件的第一条记录
   * @param tableName 表名
   * @param conditions 查询条件（可选）
   * @returns 匹配的第一条记录或 undefined
   */
  findOne(tableName: string, conditions?: Record<string, any>): Promise<any | undefined>;

  /**
   * 关闭数据库连接池
   */
  close(): Promise<void>;
  /**
   * 创建表（如果不存在）
   * @param tableName 表名
   * @param schema 表结构定义（结构化对象）
   */
  createTable(tableName: string, schema: TableSchema): Promise<void>;

  /**
   * 更新表结构
   * @param tableName 表名
   * @param updates ALTER TABLE 的结构化描述（同 schema 结构）
   */
  updateTableStructure(tableName: string, updates: Partial<TableSchema>): Promise<void>;
  /**
   * 检查表是否存在
   * @param tableName 表名
   * @returns 是否存在该表
   */
  tableExists(tableName: string): Promise<boolean>;
}
/**
 * 表结构定义
 */
type TableSchema = Record<
string,
{
  type: string
  primaryKey?: boolean
  autoIncrement?: boolean
  notNull?: boolean
  unique?: boolean
  default?: any
}
>