import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
// 从 'sqlite3' 模块中导入 Database (并重命名为 SQLite3Driver)。
// 注意：RunResult 不从这里导入，因为它通常与 Statement 合并，且 sqlite 包装库返回的是简化结果。
import { Database as SQLite3Driver } from 'sqlite3';
// 从 'sqlite' 包装库中导入 open 函数和 Database 类型。
import { open, Database } from 'sqlite';
import path from 'path';

export const provide = ['database'];

// 定义一个更精确的 RunResult 接口，以匹配 sqlite 包装库 db.run() 的实际返回。
// 它通常只包含 lastID 和 changes。
interface SqliteWrapperRunResult {
    lastID?: number;  // 插入操作的最后一个ID
    changes?: number; // 影响的行数 (更新/删除操作)
}

/**
 * 通用的数据库操作类，封装了SQLite连接和常见的CRUD操作。
 */
class SqliteDatabase {
    // connectionPromise 在构造函数中被初始化为一个 Promise，用于确保数据库连接异步完成。
    private connectionPromise: Promise<Database>;

    /**
     * 构造函数，在实例化时尝试连接到SQLite数据库。
     * @param dbPath 数据库文件的路径 (例如: './mydb.sqlite' 或 ':memory:' 用于内存数据库)
     */
    constructor(dbPath: string) {
        this.connectionPromise = open({
            filename: dbPath,
            driver: SQLite3Driver // 使用重命名后的 SQLite3Driver 作为底层驱动
        })
        .then(db => {
            logger.info(`Successfully connected to SQLite database at ${dbPath}`);
            return db; // 返回已连接的数据库实例
        })
        .catch(error => {
            logger.error(`Error connecting to database at ${dbPath}:`, error);
            throw error; // 抛出错误以便外部捕获
        });
    }

    /**
     * 内部辅助方法：获取已连接的数据库实例。
     * 任何操作都需要等待此 Promise 完成，确保数据库已连接。
     * @returns Promise<Database> 已连接的数据库实例。
     */
    private async getDb(): Promise<Database> {
        return this.connectionPromise;
    }

    /**
     * 执行原始SQL语句（如INSERT, UPDATE, DELETE），不返回行数据。
     * @param sql SQL查询字符串。
     * @param params 可选参数，用于SQL中的占位符 (`?`)。
     * @returns Promise<SqliteWrapperRunResult> 包含 lastID (插入操作) 和 changes (修改/删除操作) 的结果对象。
     */
    public async runSQL(sql: string, params: any[] = []): Promise<SqliteWrapperRunResult> {
        const db = await this.getDb();
        const result = await db.run(sql, params);
        return result;
    }

    /**
     * 执行原始SQL SELECT查询，返回所有匹配的行。
     * @param sql SQL SELECT查询字符串。
     * @param params 可选参数，用于SQL中的占位符。
     * @returns Promise<any[]> 包含查询结果的数组。
     */
    public async all(sql: string, params: any[] = []): Promise<any[]> {
        const db = await this.getDb();
        return db.all(sql, params);
    }

    /**
     * 执行原始SQL SELECT查询，返回第一个匹配的行。
     * @param sql SQL SELECT查询字符串。
     * @param params 可选参数，用于SQL中的占位符。
     * @returns Promise<any | undefined> 第一个匹配的行对象，如果没有匹配则为 undefined。
     */
    public async get(sql: string, params: any[] = []): Promise<any | undefined> {
        const db = await this.getDb();
        return db.get(sql, params);
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
        // lastID 属性可能为 undefined (例如：如果表没有自增ID列)
        // 这里假设会返回一个 ID，如果你的表结构不支持，可能需要更严谨的处理。
        return result.lastID as number;
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

        const db = await this.getDb();
        // 假设所有数据对象具有相同的键，从中获取列名
        const columns = Object.keys(dataArray[0]);
        const placeholders = `(${columns.map(() => '?').join(', ')})`;
        const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES ${placeholders}`;

        await db.exec('BEGIN TRANSACTION'); // 开始事务
        try {
            // 准备一个语句，可在事务中重复使用
            const stmt = await db.prepare(sql);
            for (const data of dataArray) {
                const values = columns.map(col => data[col]);
                await stmt.run(values); // 执行预处理语句
            }
            await stmt.finalize(); // 释放预处理语句
            await db.exec('COMMIT'); // 提交事务
            logger.info(`Batch insert into ${tableName} successful.`);
        } catch (error) {
            await db.exec('ROLLBACK'); // 发生错误时回滚事务
            logger.error(`Batch insert into ${tableName} failed, rolling back:`, error);
            throw error; // 重新抛出错误，以便外部捕获
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
            throw new Error("No data provided for update.");
        }
        if (whereParts.length === 0) {
            // 警告：没有条件会更新所有行，为了安全，建议强制要求有条件
            logger.warn("Update operation without conditions will affect all rows. Consider adding conditions.");
            // 生产环境下可能抛出错误而非仅仅警告
            // throw new Error("Update operation requires conditions to prevent accidental full table update.");
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
            throw new Error("Delete operation requires conditions to prevent accidental full table deletion.");
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
     * 关闭数据库连接。
     * 这个方法是幂等的，可以多次调用而不会出错。
     */
    public async close(): Promise<void> {
        try {
            const db = await this.getDb(); // 确保连接已就绪
            // 只有当 db 实例存在且尚未关闭时才尝试关闭
            // sqlite 库的 close() 也会处理重复关闭的情况，但额外判断可以更清晰
            if (db) {
                await db.close();
                logger.info("Database connection closed.");
            }
        } catch (error) {
            // 如果在连接关闭过程中发生错误（如连接已经关闭，但底层sqlite3仍有报错），这里捕获并打印警告。
            logger.warn("Could not close database connection cleanly:", error);
        }
    }
}

const logger = new Logger("database");

export const config = {
  schema: {
    path: {
      type: 'string',
      default: 'data/database.db',
      description: '数据库文件路径（相对路径）'
    }
  } as Record<string, ConfigSchema>
};
export async function apply(ctx: Context, config: Config) {
  const db = new SqliteDatabase(path.join(process.cwd(), config.get<string>('path', 'data/database.db')));
  ctx.registerComponent('database', db);
}