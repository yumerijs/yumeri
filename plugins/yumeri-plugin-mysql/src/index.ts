import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import mysql from 'mysql2/promise'; // 导入 mysql2/promise
import {
    TableSchema,
    ColumnDefinition,
    QueryConditions,
    QueryOperator,
    FindOptions,
    OrderByOption,
    AlterColumnAction,
    ColumnAlteration
} from './types'; // 假设类型定义在同目录下的 types.ts

export const provide = ['database'];

const logger = new Logger("mysql"); // 提前实例化 Logger

// 辅助函数：将友好类型映射到 SQL 类型
function mapFriendlyTypeToSQL(def: ColumnDefinition): string {
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

// 辅助函数：构建列的 SQL 片段
function buildColumnSQL(field: string, def: ColumnDefinition): string {
    let parts = [`\`${field}\` ${mapFriendlyTypeToSQL(def)}`];

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
// 辅助函数：构建 WHERE 子句及其参数
function buildWhereClause(conditions: QueryConditions, params: any[]): string {
    const clauseParts: string[] = [];

    // 辅助函数：判断一个对象是否是普通的 JavaScript 对象（非数组、非Date等）
    function isPlainObject(val: any): val is Record<string, any> {
        return typeof val === 'object' && val !== null && !Array.isArray(val) && !(val instanceof Date);
    }

    for (const key in conditions) {
        if (!Object.prototype.hasOwnProperty.call(conditions, key)) continue;

        const value = conditions[key];

        if (key === '$or' || key === '$and') { // 合并处理 $or 和 $and
            if (Array.isArray(value) && value.length > 0) {
                const operatorGroup: string[] = [];
                const logicalOperator = key === '$or' ? ' OR ' : ' AND ';

                for (const subCondition of value) {
                    if (isPlainObject(subCondition)) {
                        const subParams: any[] = [];
                        // 修复点：先断言为 unknown，再断言为 QueryConditions
                        const subClause = buildWhereClause(subCondition as unknown as QueryConditions, subParams);
                        if (subClause) {
                            operatorGroup.push(`(${subClause})`);
                            params.push(...subParams);
                        }
                    } else {
                        logger.warn(`Invalid ${key} condition detected for key: ${key}. Expected a plain object for sub-condition.`);
                    }
                }
                if (operatorGroup.length > 0) {
                    clauseParts.push(`(${operatorGroup.join(logicalOperator)})`);
                }
            } else {
                logger.warn(`Invalid ${key} value for key: ${key}. Expected a non-empty array.`);
            }
        }
        else if (isPlainObject(value) && Object.keys(value).some(opKey => opKey.startsWith('$'))) {
            // ... (这部分逻辑保持不变，因为 $eq 等操作符内部的值可以是 Date，但 value 本身必须是纯对象)
            const field = `\`${key}\``;
            const operatorConditions: string[] = [];
            const queryOperator = value as QueryOperator;

            for (const opKey in queryOperator) {
                if (!Object.prototype.hasOwnProperty.call(queryOperator, opKey)) continue;

                const opValue = queryOperator[opKey as keyof QueryOperator];

                switch (opKey) {
                    case '$eq': operatorConditions.push(`${field} = ?`); params.push(opValue); break;
                    case '$ne': operatorConditions.push(`${field} != ?`); params.push(opValue); break;
                    case '$gt': operatorConditions.push(`${field} > ?`); params.push(opValue); break;
                    case '$gte': operatorConditions.push(`${field} >= ?`); params.push(opValue); break;
                    case '$lt': operatorConditions.push(`${field} < ?`); params.push(opValue); break;
                    case '$lte': operatorConditions.push(`${field} <= ?`); params.push(opValue); break;
                    case '$in':
                        if (Array.isArray(opValue) && opValue.length > 0) {
                            operatorConditions.push(`${field} IN (${opValue.map(() => '?').join(', ')})`);
                            params.push(...opValue);
                        } else { operatorConditions.push('FALSE'); }
                        break;
                    case '$nin':
                        if (Array.isArray(opValue) && opValue.length > 0) {
                            operatorConditions.push(`${field} NOT IN (${opValue.map(() => '?').join(', ')})`);
                            params.push(...opValue);
                        } else { operatorConditions.push('TRUE'); }
                        break;
                    case '$like': operatorConditions.push(`${field} LIKE ?`); params.push(opValue); break;
                    case '$notLike': operatorConditions.push(`${field} NOT LIKE ?`); params.push(opValue); break;
                    case '$between':
                        if (Array.isArray(opValue) && opValue.length === 2) {
                            operatorConditions.push(`${field} BETWEEN ? AND ?`);
                            params.push(opValue[0], opValue[1]);
                        }
                        break;
                    case '$notBetween':
                        if (Array.isArray(opValue) && opValue.length === 2) {
                            operatorConditions.push(`${field} NOT BETWEEN ? AND ?`);
                            params.push(opValue[0], opValue[1]);
                        }
                        break;
                    case '$isNull':
                        if (opValue === true) { operatorConditions.push(`${field} IS NULL`); } else if (opValue === false) { operatorConditions.push(`${field} IS NOT NULL`); }
                        break;
                    case '$notNull':
                        if (opValue === true) { operatorConditions.push(`${field} IS NOT NULL`); } else if (opValue === false) { operatorConditions.push(`${field} IS NULL`); }
                        break;
                    default:
                        logger.warn(`Unsupported query operator: ${opKey} for field \`${key}\`.`);
                        break;
                }
            }
            if (operatorConditions.length > 0) {
                clauseParts.push(`(${operatorConditions.join(' AND ')})`);
            }
        }
        else {
            // 简单相等匹配
            clauseParts.push(`\`${key}\` = ?`);
            params.push(value);
        }
    }

    return clauseParts.join(' AND ');
}

export class MysqlDatabase {
    private pool: mysql.Pool;

    constructor(config: mysql.PoolOptions) {
        this.pool = mysql.createPool(config);
    }

    // 执行 SQL，返回影响行数和插入 ID
    async runSQL(sql: string, params: any[] = []): Promise<{ insertId?: number; affectedRows?: number }> {
        try {
            const [result] = await this.pool.execute(sql, params);
            const { insertId, affectedRows } = result as mysql.ResultSetHeader;
            return { insertId, affectedRows };
        } catch (error: any) {
            logger.error(`Error running SQL: ${sql} with params: ${JSON.stringify(params)} - ${error.message}`, error);
            throw error; // 重新抛出以便上层处理
        }
    }

    // 查询所有结果
    async all(sql: string, params: any[] = []): Promise<any[]> {
        try {
            const [rows] = await this.pool.execute(sql, params);
            return rows as any[];
        } catch (error: any) {
            logger.error(`Error querying all: ${sql} with params: ${JSON.stringify(params)} - ${error.message}`, error);
            throw error;
        }
    }

    // 查询单个结果
    async get(sql: string, params: any[] = []): Promise<any | undefined> {
        const rows = await this.all(sql, params);
        return rows[0];
    }

    // 插入一条数据，返回 insertId
    async insert(tableName: string, data: Record<string, any>): Promise<number> {
        const keys = Object.keys(data);
        const values = Object.values(data);
        const placeholders = keys.map(() => '?').join(', ');

        if (keys.length === 0) {
            logger.warn(`No data provided for insert into table \`${tableName}\`. Returning 0 for insertId.`);
            return 0; // 或者抛出错误
        }

        const sql = `INSERT INTO \`${tableName}\` (${keys.map(k => `\`${k}\``).join(', ')}) VALUES (${placeholders})`;
        const result = await this.runSQL(sql, values);
        return result.insertId || 0; // 当没有 insertId 时返回 0
    }

    // 批量插入（事务处理）
    async batchInsert(tableName: string, dataArray: Record<string, any>[]): Promise<void> {
        if (dataArray.length === 0) {
            logger.warn(`No data provided for batch insert into table \`${tableName}\`.`);
            return;
        }

        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();

            for (const data of dataArray) {
                const keys = Object.keys(data);
                if (keys.length === 0) {
                    logger.warn(`Skipping empty data object in batch insert for table \`${tableName}\`.`);
                    continue;
                }
                const values = Object.values(data);
                const placeholders = keys.map(() => '?').join(', ');
                const sql = `INSERT INTO \`${tableName}\` (${keys.map(k => `\`${k}\``).join(', ')}) VALUES (${placeholders})`;
                await connection.execute(sql, values);
            }

            await connection.commit();
            logger.info(`Batch insert into table \`${tableName}\` successful.`);
        } catch (err: any) {
            await connection.rollback();
            logger.error(`Batch insert into table \`${tableName}\` failed: ${err.message}`, err);
            throw err;
        } finally {
            connection.release();
        }
    }

    // 更新数据
    async update(tableName: string, data: Record<string, any>, conditions: QueryConditions): Promise<number> {
        const setClause = Object.keys(data).map(key => `\`${key}\` = ?`).join(', ');
        const setValues = Object.values(data);

        if (setClause === '') {
            logger.warn(`No data to update for table \`${tableName}\`.`);
            return 0;
        }

        const whereParams: any[] = [];
        const whereClause = buildWhereClause(conditions, whereParams);

        let sql = `UPDATE \`${tableName}\` SET ${setClause}`;
        if (whereClause) {
            sql += ` WHERE ${whereClause}`;
        } else {
            logger.warn(`No WHERE conditions provided for update on table \`${tableName}\`. All rows will be updated.`);
            // 可以选择抛出错误或要求明确允许全局更新
        }

        const result = await this.runSQL(sql, [...setValues, ...whereParams]);
        return result.affectedRows || 0;
    }

    // 删除数据
    async delete(tableName: string, conditions: QueryConditions): Promise<number> {
        const whereParams: any[] = [];
        const whereClause = buildWhereClause(conditions, whereParams);

        let sql = `DELETE FROM \`${tableName}\``;
        if (whereClause) {
            sql += ` WHERE ${whereClause}`;
        } else {
            logger.warn(`No WHERE conditions provided for delete on table \`${tableName}\`. All rows will be deleted.`);
            // 可以选择抛出错误或要求明确允许全局删除
        }

        const result = await this.runSQL(sql, whereParams);
        return result.affectedRows || 0;
    }

    // 查询列表
    async find(tableName: string, conditions: QueryConditions = {}, options: FindOptions = {}): Promise<any[]> {
        const params: any[] = [];
        const whereClause = buildWhereClause(conditions, params);

        let selectClause = options.select && options.select.length > 0
            ? options.select.map(col => `\`${col}\``).join(', ')
            : '*';

        let sql = `SELECT ${selectClause} FROM \`${tableName}\``;

        if (whereClause) sql += ` WHERE ${whereClause}`;

        if (options.groupBy) {
            const groupByColumns = Array.isArray(options.groupBy) ? options.groupBy : [options.groupBy];
            sql += ` GROUP BY ${groupByColumns.map(col => `\`${col}\``).join(', ')}`;
        }

        if (options.having) {
            sql += ` HAVING ${options.having}`; // HAVING 语句通常不使用占位符，如果需要，请自行构建
        }

        if (options.orderBy) {
            const orderByArr: OrderByOption[] = Array.isArray(options.orderBy)
                ? options.orderBy.map(item => typeof item === 'string' ? { field: item } : item)
                : [typeof options.orderBy === 'string' ? { field: options.orderBy } : options.orderBy];

            const orderByParts = orderByArr.map(item => {
                const direction = item.direction ? ` ${item.direction}` : '';
                return `\`${item.field}\`${direction}`;
            });
            sql += ` ORDER BY ${orderByParts.join(', ')}`;
        }

        if (options.limit) sql += ` LIMIT ${options.limit}`;
        if (options.offset) sql += ` OFFSET ${options.offset}`;

        return await this.all(sql, params);
    }

    // 查询单个记录
    async findOne(tableName: string, conditions: QueryConditions = {}, options: FindOptions = {}): Promise<any | undefined> {
        const results = await this.find(tableName, conditions, { ...options, limit: 1 });
        return results[0];
    }

    // 关闭连接池
    async close(): Promise<void> {
        try {
            await this.pool.end();
            logger.info('MySQL connection pool closed.');
        } catch (error: any) {
            logger.error(`Error closing MySQL pool: ${error.message}`, error);
            throw error;
        }
    }

    async createTable(tableName: string, schema: TableSchema): Promise<void> {
        const exists = await this.tableExists(tableName);
        if (exists) {
            logger.info(`Table \`${tableName}\` already exists, skipping creation.`);
            return;
        }

        const columns = Object.entries(schema).map(([field, def]) => buildColumnSQL(field, def));
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

    // 更新表结构（支持 ADD COLUMN, MODIFY COLUMN, DROP COLUMN）
    async updateTableStructure(tableName: string, alterations: ColumnAlteration[]): Promise<void> {
        if (alterations.length === 0) {
            logger.warn(`No alterations provided for table \`${tableName}\`.`);
            return;
        }

        const alterStatements: string[] = [];
        for (const alt of alterations) {
            switch (alt.action) {
                case 'ADD':
                    if (!alt.definition) throw new Error(`Column definition required for ADD action for field: ${alt.field}`);
                    alterStatements.push(`ADD COLUMN ${buildColumnSQL(alt.field, alt.definition)}`);
                    break;
                case 'MODIFY':
                    if (!alt.definition) throw new Error(`Column definition required for MODIFY action for field: ${alt.field}`);
                    // MODIFY COLUMN 保持原有位置，或明确指定 AFTER/FIRST
                    alterStatements.push(`MODIFY COLUMN ${buildColumnSQL(alt.field, alt.definition)}`);
                    break;
                case 'DROP':
                    alterStatements.push(`DROP COLUMN \`${alt.field}\``);
                    break;
                default:
                    logger.warn(`Unsupported alteration action: ${alt.action} for table \`${tableName}\`, field \`${alt.field}\`.`);
                    break;
            }
        }

        if (alterStatements.length === 0) {
            logger.warn(`No valid alterations to apply for table \`${tableName}\`.`);
            return;
        }

        const sql = `ALTER TABLE \`${tableName}\` ${alterStatements.join(', ')}`;
        await this.runSQL(sql);
        logger.info(`Table \`${tableName}\` structure updated successfully.`);
    }

    // 判断表是否存在
    async tableExists(tableName: string): Promise<boolean> {
        // 使用 pool.query 来避免 SHOW TABLES LIKE 的预处理问题
        try {
            const [rows] = await this.pool.query('SHOW TABLES LIKE ?', [tableName]);
            // rows 是一个包含 RowDataPacket 的数组，需要检查它的长度
            return (rows as mysql.RowDataPacket[]).length > 0;
        } catch (error: any) {
            logger.error(`Error checking table existence for \`${tableName}\`: ${error.message}`, error);
            throw error;
        }
    }
}

// 模块的配置 schema
// ConfigSchema 应该从 yumeri 导入，这里假设它是一个 Record<string, any>
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
            required: true,
            description: 'MySQL用户名'
        },
        password: {
            type: 'string',
            required: true,
            description: 'MySQL密码'
        },
        database: {
            type: 'string',
            required: true,
            description: '要连接的数据库名称'
        },
        connectionLimit: {
            type: 'number',
            default: 10,
            description: '连接池最大连接数'
        },
        charset: {
            type: 'string',
            default: 'utf8mb4',
            description: '数据库连接字符集'
        },
        dateStrings: {
            type: 'boolean',
            default: false,
            description: '是否将日期时间类型作为字符串返回'
        }
    } as Record<string, ConfigSchema> // 确保与 Yumeri 的 ConfigSchema 类型兼容
};

// 插件的 apply 函数
export async function apply(ctx: Context, config: Config) {
    const mysqlOptions: mysql.PoolOptions = {
        host: config.get<string>('host', 'localhost'),
        port: config.get<number>('port', 3306),
        user: config.get<string>('user', ''),
        password: config.get<string>('password', ''),
        database: config.get<string>('database', ''),
        connectionLimit: config.get<number>('connectionLimit', 10),
        charset: config.get<string>('charset', 'utf8mb4'),
        dateStrings: config.get<boolean>('dateStrings', false),
        namedPlaceholders: false, // 强制使用 ? 占位符
        rowsAsArray: false // 返回结果为对象而不是数组
    };

    // 检查必填项，并直接抛出错误以防止后续连接失败
    if (!mysqlOptions.user) {
        throw new Error("MySQL plugin: 'user' is required in config.");
    }
    if (!mysqlOptions.password) {
        throw new Error("MySQL plugin: 'password' is required in config.");
    }
    if (!mysqlOptions.database) {
        throw new Error("MySQL plugin: 'database' is required in config.");
    }

    const db = new MysqlDatabase(mysqlOptions);

    try {
        // 尝试获取一个连接以验证配置和连接性
        const connection = await db['pool'].getConnection(); // 直接访问 private pool
        connection.release();
        logger.info('MySQL database connection test successful.');
    } catch (error: any) {
        logger.error(`MySQL database connection test failed: ${error.message}`, error);
    }

    ctx.registerComponent('database', db);
    logger.info('MySQL database component registered.');
}