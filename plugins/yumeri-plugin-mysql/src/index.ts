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
            const subResults = subQueries.map(buildWhereClause);
            if (subResults.length > 0) {
                const operator = key === '$or' ? ' OR ' : ' AND ';
                conditions.push(`(${subResults.map(r => r.sql).join(operator)})`);
                params.push(...subResults.flatMap(r => r.params));
            }
            continue;
        }

        const value = query[key];
        if (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).some(k => k.startsWith('$'))) {
            const operatorKeys = Object.keys(value) as (keyof Operator<any>)[];
            for (const op of operatorKeys) {
                const opValue = value[op];
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
                        } else {
                            conditions.push('0=1');
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

    async extend<K extends keyof Tables>(table: K, schema: Schema<Partial<Tables[K]>>, indexes?: IndexDefinition<Tables[K]>): Promise<void> {
        const tableName = table as string;
        const [rows] = await this.pool.query('SHOW TABLES LIKE ?', [tableName]);
        const tableExists = (rows as any[]).length > 0;

        if (!tableExists) {
            const fields = Object.keys(schema);
            const columns = fields.map(field => this.buildColumnSql(field, this.getFieldDef(schema[field])));
            if (indexes?.primary) {
                const primaryKeys = (Array.isArray(indexes.primary) ? indexes.primary : [indexes.primary]) as string[];
                columns.push(`PRIMARY KEY (${primaryKeys.map(k => `\`${k}\``).join(', ')})`);
            }
            if (indexes?.unique) {
                indexes.unique.forEach(uniqueKey => {
                    const keys = (Array.isArray(uniqueKey) ? uniqueKey : [uniqueKey]) as string[];
                    columns.push(`UNIQUE KEY (${keys.map(k => `\`${k}\``).join(', ')})`);
                });
            }
            const sql = `CREATE TABLE ${tableName} (${columns.join(', ')}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
            logger.info(`Creating table "${tableName}"`);
            await this.run(sql);
        } else {
            const [existingCols] = await this.pool.query(`DESCRIBE \`${tableName}\``);
            const existingColNames = (existingCols as any[]).map(c => c.Field);
            const newFields = Object.keys(schema).filter(field => !existingColNames.includes(field));
            if (newFields.length > 0) {
                const alterStatements = newFields.map(field => `ADD COLUMN ${this.buildColumnSql(field, this.getFieldDef(schema[field]))}`);
                logger.info(`Altering table "${tableName}" to add new columns: ${newFields.join(', ')}`);
                await this.run(`ALTER TABLE ${tableName} ${alterStatements.join(', ')}`);
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