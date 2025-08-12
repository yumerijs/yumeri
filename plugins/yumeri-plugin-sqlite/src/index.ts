import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import { Database as SQLite3Driver } from 'sqlite3';
import { Database as YumeriDatabase, QueryConditions, TableSchema, ColumnDefinition, ColumnAlteration } from '@yumerijs/types/dist/database';
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
class SqliteDatabase implements YumeriDatabase {
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
     * 内部执行SQL
     * @private
     * @param sql SQL语句
     * @param params 参数数组
     * @returns Promise<any> 查询结果
     */
    private async run(sql: string, params?: any[]): Promise<any> {
        const db = await this.getDb();
        return db.run(sql, params);
    }

    /**
     * 执行原始SQL语句（如INSERT, UPDATE, DELETE）
     * @param sql SQL语句
     * @param params 参数数组
     * @returns Promise<void> 操作完成后的Promise
     */
    public async runSQL(sql: string, params?: any[]): Promise<{
        insertId?: number;
        affectedRows?: number;
    }> {
        const db = await this.getDb();
        const result = await db.run(sql, params);
        return {
            insertId: result.lastID,
            affectedRows: result.changes
        }
    }
    /**
     * 检查表是否存在
     * @param tableName 表名
     */
    public async tableExists(tableName: string): Promise<boolean> {
        const db = await this.getDb();
        const result = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [tableName]);
        return !!result;
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
        const result = await this.run(sql, values);
        return result.lastID;
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
    public async update(tableName: string, data: Record<string, any>, conditions: QueryConditions): Promise<number> {
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
        return params.length;
    }

    /**
     * 从指定表中删除记录。
     * @param tableName 表名。
     * @param conditions 一个对象，键为列名，值为过滤删除的条件。
     * @returns Promise<void>
     */
    public async delete(tableName: string, conditions: QueryConditions): Promise<number> {
        const whereParts = Object.keys(conditions).map(key => `${key} = ?`);

        if (whereParts.length === 0) {
            // 强制要求条件，防止意外删除整个表的数据
            throw new Error("Delete operation requires conditions to prevent accidental full table deletion.");
        }

        const sql = `DELETE FROM ${tableName} WHERE ${whereParts.join(' AND ')}`;
        const params = Object.values(conditions);

        await this.runSQL(sql, params);
        return params.length;
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
    async createTable(tableName: string, schema: TableSchema): Promise<void> {
        const exists = await this.tableExists(tableName);
        if (exists) {
            logger.info(`Table \`${tableName}\` already exists, skipping creation.`);
            return;
        }

        const columns = Object.entries(schema).map(([field, def]) => this.buildColumnSQL(field, def));
        const primaryKeys = Object.entries(schema)
            .filter(([, def]) => def.primaryKey)
            .map(([field]) => `\`${field}\``);

        if (primaryKeys.length > 0) {
            columns.push(`PRIMARY KEY (${primaryKeys.join(', ')})`);
        }

        const sql = `CREATE TABLE \`${tableName}\` (${columns.join(', ')})`;
        await this.runSQL(sql);
        logger.info(`Table \`${tableName}\` created successfully.`);
    }
    // 辅助函数：构建列的 SQL 片段
    private buildColumnSQL(field: string, def: ColumnDefinition): string {
        let parts = [`\`${field}\` ${this.mapFriendlyTypeToSQL(def)}`];

        if (def.unsigned) parts.push('UNSIGNED');
        if (def.zerofill) parts.push('ZEROFILL');
        if (def.notNull) parts.push('NOT NULL');
        if (def.unique) parts.push('UNIQUE');
        if (def.autoIncrement) parts.push('AUTO_INCREMENT');

        if (def.default !== undefined) {
            if (def.default === 'CURRENT_TIMESTAMP_FUNC' && ['DATETIME', 'TIMESTAMP'].includes(def.type.toUpperCase())) {
                parts.push('DEFAULT CURRENT_TIMESTAMP');
            } else if (typeof def.default === 'string') {
                parts.push(`DEFAULT '${def.default}'`);
            } else if (def.default === null) {
                parts.push(`DEFAULT NULL`); // 明确指定 NULL
            } else {
                parts.push(`DEFAULT ${def.default}`);
            }
        }

        if (def.onUpdate === 'CURRENT_TIMESTAMP_FUNC' && ['DATETIME', 'TIMESTAMP'].includes(def.type.toUpperCase())) {
            parts.push('ON UPDATE CURRENT_TIMESTAMP');
        }

        if (def.comment) {
            parts.push(`COMMENT '${def.comment}'`);
        }

        return parts.join(' ');
    }
    private mapFriendlyTypeToSQL(def: ColumnDefinition): string {
        let sqlType = def.type.toUpperCase();
        switch (sqlType) {
            case 'STRING':
                return `VARCHAR(${def.length || 255})`; // 默认长度 255
            case 'NUMBER':
                return `INT`; // 默认 INT, 也可以根据 length/precision 进一步判断
            case 'BOOLEAN':
                return `TINYINT(1)`;
            case 'DECIMAL':
                return `DECIMAL(${def.precision || 10},${def.scale || 2})`;
            case 'CHAR':
                return `CHAR(${def.length || 1})`;
            case 'VARCHAR':
                return `VARCHAR(${def.length || 255})`;
            case 'ENUM':
                if (!def.enum || def.enum.length === 0) {
                    throw new Error(`ENUM type requires 'enum' property with at least one value for field: ${def.comment || ''}`);
                }
                return `ENUM(${def.enum.map(val => `'${val}'`).join(', ')})`;
            default:
                return sqlType;
        }
    }
    public async updateTableStructure(tableName: string, alterations: ColumnAlteration[]): Promise<void> {
        const db = await this.getDb();

        // 1. 拿当前表结构
        const pragmaColumns: Array<{
            cid: number;
            name: string;
            type: string;
            notnull: number;
            dflt_value: any;
            pk: number;
        }> = await db.all(`PRAGMA table_info(${tableName})`);

        const currentCols = pragmaColumns.reduce((acc, col) => {
            acc[col.name] = col;
            return acc;
        }, {} as Record<string, typeof pragmaColumns[0]>);

        // 判断有没有除新增以外的操作，除新增都需要重建表
        let onlyAdd = alterations.every(a => a.action === 'ADD');

        if (onlyAdd) {
            // 只新增列，走ALTER TABLE ADD COLUMN
            for (const alt of alterations) {
                if (!alt.field || !alt.definition) continue;
                const colSQL = this.buildColumnSQL(alt.field, alt.definition);
                const sql = `ALTER TABLE ${tableName} ADD COLUMN ${colSQL}`;
                await this.run(sql);
            }
            return;
        }

        // 2. 重建表流程：

        // 收集要删的列名
        const dropSet = new Set(alterations.filter(a => a.action === 'DROP').map(a => a.field));
        // 收集修改的列定义映射
        const modifyMap = new Map<string, ColumnDefinition>();
        for (const alt of alterations) {
            if (alt.action === 'MODIFY' && alt.field && alt.definition) {
                modifyMap.set(alt.field, alt.definition);
            }
        }
        // 收集新增列定义映射
        const addMap = new Map<string, ColumnDefinition>();
        for (const alt of alterations) {
            if (alt.action === 'ADD' && alt.field && alt.definition) {
                addMap.set(alt.field, alt.definition);
            }
        }

        // 组合新表列
        let newColumns: { name: string; definition: ColumnDefinition }[] = [];

        // 先处理旧表的列，删的跳过，修改的用新定义，没改的原样
        for (const col of pragmaColumns) {
            if (dropSet.has(col.name)) continue; // 删掉

            if (modifyMap.has(col.name)) {
                newColumns.push({ name: col.name, definition: modifyMap.get(col.name)! });
            } else {
                newColumns.push({
                    name: col.name,
                    definition: {
                        type: col.type as any || 'TEXT',
                        notNull: col.notnull === 1,
                        default: col.dflt_value,
                        primaryKey: col.pk === 1,
                    },
                });
            }
        }

        // 再加上新增列
        for (const [name, def] of addMap.entries()) {
            newColumns.push({ name, definition: def });
        }

        // 3. 生成新表名和建表SQL
        const tmpTable = `${tableName}_tmp_${Date.now()}`;
        const columnsSQL = newColumns.map(c => this.buildColumnSQL(c.name, c.definition)).join(', ');
        let pkCols = newColumns.filter(c => c.definition.primaryKey).map(c => `\`${c.name}\``);
        let pkSQL = pkCols.length > 0 ? `, PRIMARY KEY (${pkCols.join(', ')})` : '';
        const createSQL = `CREATE TABLE ${tmpTable} (${columnsSQL}${pkSQL})`;
        await this.run(createSQL);

        // 4. 数据搬迁，旧表列名对应新表列名一样，新增列数据用NULL
        // 旧表有效列（没删的）
        const oldCols = pragmaColumns.filter(col => !dropSet.has(col.name)).map(c => `\`${c.name}\``);
        // 新表列，顺序是newColumns，旧表有的列用原名，新增列用NULL
        const selectCols = newColumns.map(c => {
            if (oldCols.includes(`\`${c.name}\``)) {
                return `\`${c.name}\``;
            } else {
                return 'NULL';
            }
        });

        const insertSQL = `INSERT INTO ${tmpTable} (${newColumns.map(c => `\`${c.name}\``).join(', ')}) SELECT ${selectCols.join(', ')} FROM ${tableName}`;
        await this.run(insertSQL);

        // 5. 删除旧表，改名新表
        await this.run(`DROP TABLE ${tableName}`);
        await this.run(`ALTER TABLE ${tmpTable} RENAME TO ${tableName}`);
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