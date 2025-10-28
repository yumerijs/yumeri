import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import { Database as YumeriDatabase, Tables, Schema, IndexDefinition, FieldDefinition, FieldType, Query, UpdateData, Operator } from '@yumerijs/types';
import mysql from 'mysql2/promise';

const logger = new Logger("mysql");
export const provide = ['database']

// --- Query Builder (reused from sqlite implementation) ---

function buildWhereClause(query: Query<any>): { sql: string, params: any[] } {
    const conditions: string[] = [];
    const params: any[] = [];

    for (const key in query) {
        if (key === '$or' || key === '$and') {
            const subQueries = query[key] as Query<any>[];
            const subResults = subQueries.map(buildWhereClause).filter(r => r.sql);
            if (subResults.length > 0) {
                const operator = key === '$or' ? ' OR ' : ' AND ';
                conditions.push(`(${subResults.map(r => r.sql).join(operator)})`);
                params.push(...subResults.flatMap(r => r.params));
            }
            continue;
        }

        const value = query[key];

        if (value === undefined || value === null) continue;

        if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).some(k => k.startsWith('$'))) {
            const operatorKeys = Object.keys(value) as (keyof Operator<any>)[];
            for (const op of operatorKeys) {
                const opValue = value[op];
                if (opValue === undefined || opValue === null) continue; // 同样跳过

                switch (op) {
                    case '$eq': conditions.push(`\`${key}\` = ?`); params.push(opValue); break;
                    case '$ne': conditions.push(`\`${key}\` != ?`); params.push(opValue); break;
                    case '$gt': conditions.push(`\`${key}\` > ?`); params.push(opValue); break;
                    case '$gte': conditions.push(`\`${key}\` >= ?`); params.push(opValue); break;
                    case '$lt': conditions.push(`\`${key}\` < ?`); params.push(opValue); break;
                    case '$lte': conditions.push(`\`${key}\` <= ?`); params.push(opValue); break;
                    case '$in':
                        if (Array.isArray(opValue) && opValue.length > 0) {
                            conditions.push(`\`${key}\` IN (${opValue.map(() => '?').join(',')})`);
                            params.push(...opValue);
                        }
                        break;
                    case '$nin':
                        if (Array.isArray(opValue) && opValue.length > 0) {
                            conditions.push(`\`${key}\` NOT IN (${opValue.map(() => '?').join(',')})`);
                            params.push(...opValue);
                        }
                        break;
                }
            }
        } else {
            conditions.push(`\`${key}\` = ?`);
            params.push(value);
        }
    }

    return { sql: conditions.join(' AND '), params };
}

// --- Database Implementation ---

class MysqlDatabase implements YumeriDatabase {
    private constructor(private pool: mysql.Pool) { }

    static async create(options: mysql.PoolOptions): Promise<MysqlDatabase> {
        const pool = mysql.createPool(options);
        // Test connection
        const conn = await pool.getConnection();
        conn.release();
        logger.info('MySQL database connection test successful.');
        return new MysqlDatabase(pool);
    }

    private getFieldDef(def: FieldType | FieldDefinition): FieldDefinition {
        return typeof def === 'string' ? { type: def } : def;
    }

    private mapTypeToSql(def: FieldDefinition): string {
        const type = def.type.toUpperCase();
        switch (type) {
            case 'STRING': return `VARCHAR(${def.length || 255})`;
            case 'TEXT': return 'TEXT';
            case 'JSON': return 'JSON';
            case 'INTEGER': return 'INT';
            case 'UNSIGNED': return 'INT UNSIGNED';
            case 'BIGINT': return 'BIGINT';
            case 'FLOAT': return 'FLOAT';
            case 'DOUBLE': return 'DOUBLE';
            case 'DECIMAL': return `DECIMAL(${def.precision || 10}, ${def.scale || 2})`;
            case 'BOOLEAN': return 'TINYINT(1)';
            case 'DATE': return 'DATE';
            case 'TIME': return 'TIME';
            case 'TIMESTAMP': return 'TIMESTAMP';
            case 'DATETIME': return 'DATETIME';
            default: return type;
        }
    }

    private buildColumnSql(field: string, def: FieldDefinition): string {
        let sql = `\`${field}\` ${this.mapTypeToSql(def)}`;
        if (def.nullable === false) sql += ' NOT NULL';
        if (def.initial !== undefined) sql += ` DEFAULT ${this.pool.escape(def.initial)}`;
        if (def.autoIncrement) sql += ' AUTO_INCREMENT';
        return sql;
    }

    async extend<K extends keyof Tables>(
        table: K,
        schema: Schema<Partial<Tables[K]>>,
        indexes?: IndexDefinition<Tables[K]>
    ): Promise<void> {
        const tableName = table as string;
        const [rows] = await this.pool.query('SHOW TABLES LIKE ?', [tableName]);
        const tableExists = (rows as any[]).length > 0;

        if (!tableExists) {
            // 表不存在，直接创建
            const fields = Object.keys(schema);
            const columns = fields.map(field => this.buildColumnSql(field, this.getFieldDef(schema[field])));

            // 主键
            if (indexes?.primary) {
                const primaryKeys = (Array.isArray(indexes.primary) ? indexes.primary : [indexes.primary]) as string[];
                columns.push(`PRIMARY KEY (${primaryKeys.map(k => `\`${k}\``).join(', ')})`);
            }

            // 唯一索引
            if (indexes?.unique) {
                const uniqueKeys = Array.isArray(indexes.unique[0])
                    ? indexes.unique as string[][]
                    : (indexes.unique as string[][]).map(k => Array.isArray(k) ? k : [k]);

                uniqueKeys.forEach(keys => {
                    columns.push(`UNIQUE KEY (${keys.map(k => `\`${k}\``).join(', ')})`);
                });
            }

            const sql = `CREATE TABLE \`${tableName}\` (${columns.join(', ')}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
            logger.info(`Creating table "${tableName}"`);
            await this.run(sql);
        } else {
            // 表存在，检查字段和索引
            const [existingCols] = await this.pool.query(`DESCRIBE \`${tableName}\``);
            const existingColNames = (existingCols as any[]).map(c => c.Field);

            const alterClauses: string[] = [];

            // 新字段或类型修改
            for (const field of Object.keys(schema)) {
                const def = this.getFieldDef(schema[field]);
                if (!existingColNames.includes(field)) {
                    alterClauses.push(`ADD COLUMN ${this.buildColumnSql(field, def)}`);
                } else {
                    // 字段已存在，检查类型/默认值是否一致
                    const col = (existingCols as any[]).find(c => c.Field === field);
                    const newColSql = this.buildColumnSql(field, def);
                    if (!newColSql.includes(col.Type)) {
                        alterClauses.push(`MODIFY COLUMN ${newColSql}`);
                    }
                }
            }

            if (alterClauses.length > 0) {
                await this.run(`ALTER TABLE \`${tableName}\` ${alterClauses.join(', ')}`);
            }

            // 索引更新
            if (indexes) {
                const [existingIndexes] = await this.pool.query(`SHOW INDEX FROM \`${tableName}\``);
                const indexMap: Record<string, any> = {};
                (existingIndexes as any[]).forEach(idx => {
                    if (idx.Key_name !== 'PRIMARY') {
                        if (!indexMap[idx.Key_name]) indexMap[idx.Key_name] = [];
                        indexMap[idx.Key_name].push(idx.Column_name);
                    }
                });

                // 主键
                if (indexes.primary) {
                    const primaryKeys = (Array.isArray(indexes.primary) ? indexes.primary : [indexes.primary]) as string[];
                    const [pkCheck] = await this.pool.query(`SHOW KEYS FROM \`${tableName}\` WHERE Key_name = 'PRIMARY'`);
                    const existingPk = (pkCheck as any[]).map(p => p.Column_name);
                    if (primaryKeys.join(',') !== existingPk.join(',')) {
                        logger.info(`Altering table "${tableName}" primary key`);
                        await this.run(`ALTER TABLE \`${tableName}\` DROP PRIMARY KEY, ADD PRIMARY KEY (${primaryKeys.map(k => `\`${k}\``).join(',')})`);
                    }
                }

                // 唯一索引
                if (indexes.unique) {
                    const uniqueKeys = Array.isArray(indexes.unique[0])
                        ? indexes.unique as string[][]
                        : (indexes.unique as string[][]).map(k => Array.isArray(k) ? k : [k]);

                    for (const keys of uniqueKeys) {
                        const name = keys.join('_') + '_uniq';
                        const existing = indexMap[name] || [];
                        if (existing.join(',') !== keys.join(',')) {
                            // 删除旧索引再建新索引
                            if (existing.length) {
                                await this.run(`ALTER TABLE \`${tableName}\` DROP INDEX \`${name}\``);
                            }
                            await this.run(`ALTER TABLE \`${tableName}\` ADD UNIQUE INDEX \`${name}\` (${keys.map(k => `\`${k}\``).join(',')})`);
                        }
                    }
                }
            }
        }
    }

    async create<K extends keyof Tables>(table: K, data: Partial<Tables[K]>): Promise<Tables[K]> {
        const tableName = table as string;
        const keys = Object.keys(data).map(k => `\`${k}\``).join(', ');
        const placeholders = Object.keys(data).map(() => '?').join(', ');
        const sql = `INSERT INTO ${tableName} (${keys}) VALUES (${placeholders})`;
        const result = await this.run(sql, Object.values(data));
        return { ...data, id: result.insertId } as any;
    }

    async select<K extends keyof Tables, F extends keyof Tables[K]>(table: K, query: Query<Tables[K]>, fields?: F[]): Promise<Pick<Tables[K], F>[]> {
        const tableName = table as string;
        const { sql: whereSql, params } = buildWhereClause(query);
        const selectFields = fields ? fields.map(f => `\`${f as string}\``).join(', ') : '*';
        const sql = `SELECT ${selectFields} FROM ${tableName}${whereSql ? ` WHERE ${whereSql}` : ''}`;
        return this.all(sql, params);
    }

    async selectOne<K extends keyof Tables, F extends keyof Tables[K]>(table: K, query: Query<Tables[K]>, fields?: F[]): Promise<Pick<Tables[K], F> | undefined> {
        const tableName = table as string;
        const { sql: whereSql, params } = buildWhereClause(query);
        const selectFields = fields ? fields.map(f => `\`${f as string}\``).join(', ') : '*';
        const sql = `SELECT ${selectFields} FROM ${tableName}${whereSql ? ` WHERE ${whereSql}` : ''} LIMIT 1`;
        return this.get(sql, params);
    }

    async update<K extends keyof Tables>(table: K, query: Query<Tables[K]>, data: UpdateData<Partial<Tables[K]>>): Promise<number> {
        const tableName = table as string;
        const { sql: whereSql, params: whereParams } = buildWhereClause(query);
        const setParts: string[] = [];
        const setParams: any[] = [];
        for (const key in data) {
            const value = data[key as keyof typeof data];
            if (typeof value === 'object' && value !== null && '$inc' in value) {
                setParts.push(`\`${key}\` = \`${key}\` + ?`);
                setParams.push((value as { $inc: number }).$inc);
            } else {
                setParts.push(`\`${key}\` = ?`);
                setParams.push(value);
            }
        }
        if (setParts.length === 0) return 0;
        const sql = `UPDATE ${tableName} SET ${setParts.join(', ')}${whereSql ? ` WHERE ${whereSql}` : ''}`;
        const result = await this.run(sql, [...setParams, ...whereParams]);
        return result.affectedRows ?? 0;
    }

    async remove<K extends keyof Tables>(table: K, query: Query<Tables[K]>): Promise<number> {
        const tableName = table as string;
        const { sql: whereSql, params } = buildWhereClause(query);
        const sql = `DELETE FROM ${tableName}${whereSql ? ` WHERE ${whereSql}` : ''}`;
        const result = await this.run(sql, params);
        return result.affectedRows ?? 0;
    }

    async upsert<K extends keyof Tables>(table: K, data: Partial<Tables[K]>[], key: keyof Tables[K] | (keyof Tables[K])[], update?: UpdateData<Partial<Tables[K]>>): Promise<void> {
        const tableName = table as string;
        if (data.length === 0) return;

        const insertKeys = Object.keys(data[0]);
        const updatePayload = update ?? data[0];
        const updateParts: string[] = [];

        for (const key in updatePayload) {
            const value = updatePayload[key as keyof typeof updatePayload];
            if (typeof value === 'object' && value !== null && '$inc' in value) {
                updateParts.push(`\`${key}\` = \`${key}\` + ${this.pool.escape((value as any).$inc)}`);
            } else {
                updateParts.push(`\`${key}\` = VALUES(\`${key}\`)`);
            }
        }

        const sql = `
            INSERT INTO ${tableName} (${insertKeys.map(k => `\`${k}\``).join(', ')})
            VALUES ${data.map(item => `(${insertKeys.map(k => this.pool.escape(item[k as keyof typeof item])).join(', ')})`).join(', ')}
            ON DUPLICATE KEY UPDATE ${updateParts.join(', ')}
        `;
        await this.run(sql);
    }

    async drop<K extends keyof Tables>(table: K): Promise<void> {
        await this.run(`DROP TABLE IF EXISTS ${table as string}`);
    }

    async run(sql: string, params?: any[]): Promise<any> {
        const [result] = await this.pool.execute(sql, params);
        return result;
    }
    async get(sql: string, params?: any[]): Promise<any> {
        const [rows] = await this.pool.execute(sql, params);
        return (rows as any[])[0];
    }
    async all(sql: string, params?: any[]): Promise<any[]> {
        const [rows] = await this.pool.execute(sql, params);
        return rows as any[];
    }
    async close(): Promise<void> {
        await this.pool.end();
        logger.info('MySQL connection pool closed.');
    }
}

// --- Plugin Definition ---

export const config = {
    schema: {
        host: { type: 'string', default: 'localhost', description: 'MySQL 主机名' },
        port: { type: 'number', default: 3306, description: 'MySQL 端口' },
        user: { type: 'string', required: true, description: '用户名' },
        password: { type: 'string', required: true, description: '密码' },
        database: { type: 'string', required: true, description: '数据库名' },
        connectionLimit: { type: 'number', default: 10, description: '连接池大小' },
        charset: { type: 'string', default: 'utf8mb4', description: '字符集', enum: ['utf8', 'utf8mb4'] },
    } as Record<string, ConfigSchema>
};

export async function apply(ctx: Context, config: Config) {
    const options: mysql.PoolOptions = {
        host: config.get('host'),
        port: config.get('port'),
        user: config.get('user'),
        password: config.get('password'),
        database: config.get('database'),
        connectionLimit: config.get('connectionLimit'),
        charset: config.get('charset'),
    };

    if (!options.user || !options.password || !options.database) {
        logger.error('MySQL plugin is not configured correctly. Please provide user, password, and database.');
        return;
    }

    try {
        const db = await MysqlDatabase.create(options);
        ctx.registerComponent('database', db);
    } catch (error) {
        logger.error('Failed to connect to MySQL database:', error);
    }
}

export async function disable(ctx: Context) {
    const db = ctx.getComponent('database') as MysqlDatabase;
    await db.close();
}