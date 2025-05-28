import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import mysql, { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise'; // 导入 mysql2/promise

// 定义一个精确的 RunResult 接口，以匹配 mysql2 db.execute() 对非SELECT语句的实际返回。
interface MysqlWrapperRunResult {
    insertId?: number;    // 对于 INSERT 操作，返回插入的行 ID
    affectedRows?: number; // 对于 UPDATE/DELETE 操作，返回受影响的行数
    // 更多：warningStatus?: number; changedRows?: number;
}

/**
 * 通用的数据库操作类，封装了MySQL连接和常见的CRUD操作。
 * 其公共方法接口与SqliteDatabase保持一致。
 */
class MysqlDatabase {
    private connectionPoolPromise: Promise<Pool>;
    private pool: Pool | undefined; // 存储已创建的连接池实例

    /**
     * 构造函数，在实例化时尝试连接到MySQL数据库。
     * @param options MySQL连接选项 (host, port, user, password, database, connectionLimit 等)
     */
    constructor(options: mysql.PoolOptions) {
        // 使用连接池在插件环境中更好地管理连接资源
        this.connectionPoolPromise = (async () => {
            try {
                // 创建连接池
                this.pool = mysql.createPool(options);
                
                // 尝试获取一个连接以验证连接是否成功
                // get a connection and release it immediately to test connectivity
                const connection = await this.pool.getConnection();
                connection.release(); 

                logger.info(`Successfully connected to MySQL database: '${options.database}' at ${options.host}:${options.port}`);
                return this.pool;
            } catch (error) {
                logger.error(`Error connecting to MySQL database: '${options.database}' at ${options.host}:${options.port}:`, error);
                throw error; // 抛出错误以便外部捕获
            }
        })();
    }

    /**
     * 内部辅助方法：获取已连接的数据库连接池实例。
     * 任何操作都需要等待此 Promise 完成，确保数据库已连接。
     * @returns Promise<Pool> 已连接的数据库连接池实例。
     */
    private async getPool(): Promise<Pool> {
        return this.connectionPoolPromise;
    }

    /**
     * 执行原始SQL语句（如INSERT, UPDATE, DELETE, CREATE TABLE），不返回行数据。
     * @param sql SQL查询字符串。
     * @param params 可选参数，用于SQL中的占位符 (`?`)。
     * @returns Promise<MysqlWrapperRunResult> 包含 insertId (插入操作) 和 affectedRows (修改/删除操作) 的结果对象。
     */
    public async runSQL(sql: string, params: any[] = []): Promise<MysqlWrapperRunResult> {
        const pool = await this.getPool();
        // execute() 方法用于预处理语句，比 query() 更安全高效
        const [result] = await pool.execute(sql, params); 

        // 对于 INSERT/UPDATE/DELETE/DDL 语句，result 的类型通常是 ResultSetHeader
        if (typeof result === 'object' && 'affectedRows' in result) {
            const resultSetHeader = result as ResultSetHeader;
            return {
                insertId: resultSetHeader.insertId,
                affectedRows: resultSetHeader.affectedRows
            };
        } else {
            // 对于某些DDL（如CREATE TABLE）或不返回行数据的语句，affectedRows可能是0
            // 或者 result 可能不是 ResultSetHeader (例如，一个空的 RowDataPacket 数组 for SELECT)
            // 但此方法主要设计用于非SELECT语句。
            logger.warn(`runSQL executed a query that did not return a ResultSetHeader (SQL: ${sql.substring(0, 100)}...)`);
            return { affectedRows: 0, insertId: 0 }; 
        }
    }

    /**
     * 执行原始SQL SELECT查询，返回所有匹配的行。
     * @param sql SQL SELECT查询字符串。
     * @param params 可选参数，用于SQL中的占位符。
     * @returns Promise<any[]> 包含查询结果的数组。
     */
    public async all(sql: string, params: any[] = []): Promise<any[]> {
        const pool = await this.getPool();
        const [rows] = await pool.execute(sql, params); // rows 是一个 RowDataPacket[] 数组
        return rows as RowDataPacket[]; // 类型断言为 any[]
    }

    /**
     * 执行原始SQL SELECT查询，返回第一个匹配的行。
     * @param sql SQL SELECT查询字符串。
     * @param params 可选参数，用于SQL中的占位符。
     * @returns Promise<any | undefined> 第一个匹配的行对象，如果没有匹配则为 undefined。
     */
    public async get(sql: string, params: any[] = []): Promise<any | undefined> {
        const pool = await this.getPool();
        const [rows] = await pool.execute(sql, params);
        const data = rows as RowDataPacket[]; // 类型断言
        return data.length > 0 ? data[0] : undefined;
    }

    /**
     * 向指定表中插入单条记录。
     * @param tableName 表名。
     * @param data 一个对象，键为列名，值为要插入的数据。
     * @returns Promise<number> 新插入记录的 ID。
     */
    public async insert(tableName: string, data: Record<string, any>): Promise<number> {
        const columns = Object.keys(data);
        const placeholders = columns.map(() => '?').join(', ');
        const values = Object.values(data);

        const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
        const result = await this.runSQL(sql, values);
        // insertId 通常在MySQL中是自增ID，如果不存在则返回0
        return result.insertId || 0; 
    }

    /**
     * 在事务中批量插入多条记录到指定表。
     * @param tableName 表名。
     * @param dataArray 一个对象数组，每个对象代表要插入的一行数据。
     * @returns Promise<void>
     */
    public async batchInsert(tableName: string, dataArray: Record<string, any>[]): Promise<void> {
        if (dataArray.length === 0) {
            return; // 没有数据可插入
        }

        const pool = await this.getPool();
        // 假设所有数据对象具有相同的键，从中获取列名
        const columns = Object.keys(dataArray[0]);
        // 为单行数据构建占位符字符串，例如 "(?, ?, ?)"
        const singleRowPlaceholders = `(${columns.map(() => '?').join(', ')})`;

        // 为所有待插入数据构建多行占位符字符串，例如 "(?,?),(?,?)"
        const multiRowPlaceholders = dataArray.map(() => singleRowPlaceholders).join(', ');
        const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES ${multiRowPlaceholders}`;

        // 将所有行的值扁平化为一个单独的数组作为参数传递
        const allValues = dataArray.flatMap(data => columns.map(col => data[col]));

        // --- 事务处理 ---
        // 从连接池中获取一个专用连接，以便在同一事务中使用
        const connection = await pool.getConnection(); 
        try {
            await connection.beginTransaction(); // 开始事务
            await connection.execute(sql, allValues); // 执行批量插入语句
            await connection.commit(); // 提交事务
            logger.info(`Batch insert into ${tableName} successful.`);
        } catch (error) {
            await connection.rollback(); // 发生错误时回滚事务
            logger.error(`Batch insert into ${tableName} failed, rolling back:`, error);
            throw error; // 重新抛出错误
        } finally {
            connection.release(); // 无论成功失败，总是释放连接回连接池
        }
    }

    /**
     * 更新指定表的记录。
     * @param tableName 表名。
     * @param data 一个对象，键为要更新的列名，值为新数据。
     * @param conditions 一个对象，键为列名，值为过滤更新的条件。
     * @returns Promise<void>
     */
    public async update(tableName: string, data: Record<string, any>, conditions: Record<string, any>): Promise<void> {
        const setParts = Object.keys(data).map(key => `${key} = ?`);
        const whereParts = Object.keys(conditions).map(key => `${key} = ?`);

        if (setParts.length === 0) {
            logger.error("No data provided for update.");
        }
        if (whereParts.length === 0) {
            logger.warn("Update operation without conditions will affect all rows. Consider adding conditions to prevent unintended updates.");
        }

        const sql = `UPDATE ${tableName} SET ${setParts.join(', ')} ${whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''}`;
        // 参数顺序：先是SET部分的值，然后是WHERE部分的条件值
        const params = [...Object.values(data), ...Object.values(conditions)];

        await this.runSQL(sql, params);
    }

    /**
     * 从指定表中删除记录。
     * @param tableName 表名。
     * @param conditions 一个对象，键为列名，值为过滤删除的条件。
     * @returns Promise<void>
     */
    public async delete(tableName: string, conditions: Record<string, any>): Promise<void> {
        const whereParts = Object.keys(conditions).map(key => `${key} = ?`);

        if (whereParts.length === 0) {
            // 强制要求条件，防止意外删除整个表的数据
            logger.error("Delete operation requires conditions to prevent accidental full table deletion.");
        }

        const sql = `DELETE FROM ${tableName} WHERE ${whereParts.join(' AND ')}`;
        const params = Object.values(conditions);

        await this.runSQL(sql, params);
    }

    /**
     * 在指定表中查找多条记录。
     * @param tableName 表名。
     * @param conditions 可选对象，键为列名，值为过滤查询的条件。
     * @param options 可选对象，用于 orderBy (排序), limit (限制数量), offset (偏移量)。
     * @returns Promise<any[]> 匹配的行对象数组。
     */
    public async find(
        tableName: string,
        conditions?: Record<string, any>,
        options?: { orderBy?: string, limit?: number, offset?: number }
    ): Promise<any[]> {
        let sql = `SELECT * FROM ${tableName}`;
        const params: any[] = [];
        const whereParts: string[] = [];

        if (conditions) {
            for (const key in conditions) {
                // 确保只处理对象自身的属性，排除原型链上的属性
                if (Object.prototype.hasOwnProperty.call(conditions, key)) {
                    whereParts.push(`${key} = ?`);
                    params.push(conditions[key]);
                }
            }
        }

        if (whereParts.length > 0) {
            sql += ` WHERE ${whereParts.join(' AND ')}`;
        }

        if (options?.orderBy) {
            sql += ` ORDER BY ${options.orderBy}`;
        }
        // 检查 limit 是否明确给出且不是 null/undefined
        if (options?.limit !== undefined && options.limit !== null) {
            sql += ` LIMIT ?`;
            params.push(options.limit);
        }
        // 检查 offset 是否明确给出且不是 null/undefined
        if (options?.offset !== undefined && options.offset !== null) {
            sql += ` OFFSET ?`;
            params.push(options.offset);
        }

        return this.all(sql, params);
    }

    /**
     * 在指定表中查找单条记录。
     * 这个方法是对 find 的便捷封装，内部限制 limit 为 1。
     * @param tableName 表名。
     * @param conditions 可选对象，键为列名，值为过滤查询的条件。
     * @returns Promise<any | undefined> 第一个匹配的行对象，如果没有匹配则为 undefined。
     */
    public async findOne(tableName: string, conditions?: Record<string, any>): Promise<any | undefined> {
        // 利用 find 方法，并限制 limit 为 1
        const results = await this.find(tableName, conditions, { limit: 1 });
        return results.length > 0 ? results[0] : undefined;
    }

    /**
     * 关闭数据库连接池。
     * 这个方法是幂等的，可以多次调用而不会出错。
     */
    public async close(): Promise<void> {
        try {
            // 确保连接池已初始化
            await this.getPool(); 
            if (this.pool) {
                await this.pool.end(); // 关闭连接池中的所有连接
                logger.info("MySQL connection pool closed.");
                this.pool = undefined; // 清除引用
            }
        } catch (error) {
            logger.warn("Could not close MySQL connection pool cleanly:", error);
        }
    }
}

const logger = new Logger("mysql");

// 模块的配置 schema
export const config = {
  schema: {
    host: {
      type: 'string',
      default: 'localhost',
      description: 'MySQL数据库主机名'
    },
    port: {
      type: 'number',
      default: 3306,
      description: 'MySQL数据库端口'
    },
    user: {
      type: 'string',
      required: true, // 标记为必填项
      description: 'MySQL用户名'
    },
    password: {
      type: 'string',
      required: true, // 标记为必填项
      description: 'MySQL密码'
    },
    database: {
      type: 'string',
      required: true, // 标记为必填项
      description: '要连接的数据库名称'
    },
    connectionLimit: {
        type: 'number',
        default: 10,
        description: '连接池最大连接数'
    },
    // 其他可能的 mysql.PoolOptions, 如果需要在配置中暴露
    // 例如：
    // ssl: {
    //   type: 'boolean',
    //   default: false,
    //   description: '是否启用SSL连接'
    // }
  } as Record<string, ConfigSchema>
};

// 插件的 apply 函数
export async function apply(ctx: Context, config: Config) {
    // 从 Config 中获取 MySQL 连接配置
    const mysqlOptions: mysql.PoolOptions = {
        host: config.get<string>('host', 'localhost'),
        port: config.get<number>('port', 3306),
        user: config.get<string>('user', ''), 
        password: config.get<string>('password', ''), 
        database: config.get<string>('database', ''),
        connectionLimit: config.get<number>('connectionLimit', 10),
        namedPlaceholders: false, // 强制使用 ? 占位符
        rowsAsArray: false // 返回结果为对象而不是数组
    };

    // 检查必填项，虽然 schema 中有 required，但为了代码健壮性再次检查
    if (!mysqlOptions.user) {
        logger.error("MySQL plugin: 'user' is required in config.");
    }
    if (!mysqlOptions.password) {
        logger.error("MySQL plugin: 'password' is required in config.");
    }
    if (!mysqlOptions.database) {
        logger.error("MySQL plugin: 'database' is required in config.");
    }

    const db = new MysqlDatabase(mysqlOptions);

    ctx.registerComponent('database', db);
    logger.info('MySQL database component registered.');
}