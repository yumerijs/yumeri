
import { Context, Config, Logger, ConfigSchema } from 'yumeri';
import { Database as YumeriDatabase, Tables, Schema, IndexDefinition, FieldDefinition, FieldType, Query, Operator } from '@yumerijs/types';
import { open, Database as SQLiteDriver } from 'sqlite';
import { Database as SQLite3 } from 'sqlite3';
import * as path from 'path';

const logger = new Logger("sqlite");
export const provide = ['database']

// --- Query Builder --- 

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

        // 💡 新增：跳过 undefined / null 的字段
        if (value === undefined || value === null) continue;

        if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).some(k => k.startsWith('$'))) {
            const operatorKeys = Object.keys(value) as (keyof Operator<any>)[];
            for (const op of operatorKeys) {
                const opValue = value[op];
                if (opValue === undefined || opValue === null) continue; // 同样过滤空值

                switch (op) {
                    case '$eq': conditions.push(`"${key}" = ?`); params.push(opValue); break;
                    case '$ne': conditions.push(`"${key}" != ?`); params.push(opValue); break;
                    case '$gt': conditions.push(`"${key}" > ?`); params.push(opValue); break;
                    case '$gte': conditions.push(`"${key}" >= ?`); params.push(opValue); break;
                    case '$lt': conditions.push(`"${key}" < ?`); params.push(opValue); break;
                    case '$lte': conditions.push(`"${key}" <= ?`); params.push(opValue); break;
                    case '$in':
                        if (Array.isArray(opValue) && opValue.length > 0) {
                            conditions.push(`"${key}" IN (${opValue.map(() => '?').join(',')})`);
                            params.push(...opValue);
                        }
                        break;
                    case '$nin':
                        if (Array.isArray(opValue) && opValue.length > 0) {
                            conditions.push(`"${key}" NOT IN (${opValue.map(() => '?').join(',')})`);
                            params.push(...opValue);
                        }
                        break;
                }
            }
        } else {
            conditions.push(`"${key}" = ?`);
            params.push(value);
        }
    }

    return { sql: conditions.join(' AND '), params };
}

// --- Database Implementation ---

class SqliteDatabase implements YumeriDatabase {
    private constructor(private driver: SQLiteDriver) { }

    static async create(dbPath: string): Promise<SqliteDatabase> {
        const driver = await open({ filename: dbPath, driver: SQLite3 });
        logger.info(`Successfully connected to SQLite database at ${dbPath}`);
        return new SqliteDatabase(driver);
    }

    private getFieldDef(def: FieldType | FieldDefinition): FieldDefinition {
        return typeof def === 'string' ? { type: def } : def;
    }

    private mapTypeToSql(type: FieldType): string {
        const typeMap: Record<FieldType, string> = {
            string: 'TEXT', text: 'TEXT', json: 'TEXT',
            integer: 'INTEGER', unsigned: 'INTEGER UNSIGNED', bigint: 'BIGINT',
            float: 'REAL', double: 'REAL', decimal: 'REAL',
            boolean: 'INTEGER',
            date: 'TEXT', time: 'TEXT', timestamp: 'DATETIME',
        };
        return typeMap[type] || 'TEXT';
    }

    private buildColumnSql(field: string, def: FieldDefinition): string {
        let sql = `"${field}" ${this.mapTypeToSql(def.type)}`;
        if (def.nullable === false) sql += ' NOT NULL';
        if (def.initial !== undefined) sql += ` DEFAULT ${JSON.stringify(def.initial)}`;
        if (def.autoIncrement) sql += ' PRIMARY KEY AUTOINCREMENT'; // SQLite 自增
        return sql;
    }

    async extend<K extends keyof Tables>(
        table: K,
        schema: Schema<Partial<Tables[K]>>,
        indexes?: IndexDefinition<Tables[K]>
    ): Promise<void> {
        const tableName = table as string;
        const existingCols = await this.driver.all(`PRAGMA table_info("${tableName}")`).catch(() => []);

        if (existingCols.length === 0) {
            // 表不存在，创建
            const fields = Object.keys(schema);
            const columns = fields.map(field => this.buildColumnSql(field, this.getFieldDef(schema[field])));
            let sql = `CREATE TABLE "${tableName}" (${columns.join(', ')})`;
            logger.info(`Creating table "${tableName}"`);
            await this.run(sql);
        } else {
            // 表存在，检查新增字段
            for (const field of Object.keys(schema)) {
                if (!existingCols.some(col => col.name === field)) {
                    const colSql = this.buildColumnSql(field, this.getFieldDef(schema[field]));
                    logger.info(`Adding column "${tableName}"."${field}"`);
                    await this.run(`ALTER TABLE "${tableName}" ADD COLUMN ${colSql}`);
                }
            }
        }
    }

    async create<K extends keyof Tables>(table: K, data: Partial<Tables[K]>): Promise<Tables[K]> {
        const tableName = table as string;
        const keys = Object.keys(data).map(k => `"${k}"`).join(', ');
        const placeholders = Object.keys(data).map(() => '?').join(', ');
        const sql = `INSERT INTO "${tableName}" (${keys}) VALUES (${placeholders})`;
        const result = await this.run(sql, Object.values(data));
        return { ...data, id: result.lastID } as any;
    }

    async select<K extends keyof Tables, F extends keyof Tables[K]>(table: K, query: Query<Tables[K]>, fields?: F[]): Promise<Pick<Tables[K], F>[]> {
        const tableName = table as string;
        const { sql: whereSql, params } = buildWhereClause(query);
        const selectFields = fields ? fields.map(f => `"${f as string}"`).join(', ') : '*';
        const sql = `SELECT ${selectFields} FROM "${tableName}"${whereSql ? ` WHERE ${whereSql}` : ''}`;
        logger.info(sql, params)
        return this.all(sql, params);
    }

    async selectOne<K extends keyof Tables, F extends keyof Tables[K]>(table: K, query: Query<Tables[K]>, fields?: F[]): Promise<Pick<Tables[K], F> | undefined> {
        const tableName = table as string;
        const { sql: whereSql, params } = buildWhereClause(query);
        const selectFields = fields ? fields.map(f => `\"${f as string}\"`).join(', ') : '*';
        const sql = `SELECT ${selectFields} FROM \"${tableName}\"${whereSql ? ` WHERE ${whereSql}` : ''} LIMIT 1`;
        return this.get(sql, params);
    }

    async update<K extends keyof Tables>(table: K, query: Query<Tables[K]>, data: Partial<Tables[K]>): Promise<number> {
        const tableName = table as string;
        const { sql: whereSql, params: whereParams } = buildWhereClause(query);
        const setKeys = Object.keys(data);
        const setSql = setKeys.map(key => `"${key}" = ?`).join(', ');
        const setParams = Object.values(data);
        const sql = `UPDATE "${tableName}" SET ${setSql}${whereSql ? ` WHERE ${whereSql}` : ''}`;
        const result = await this.run(sql, [...setParams, ...whereParams]);
        return result.changes ?? 0;
    }

    async remove<K extends keyof Tables>(table: K, query: Query<Tables[K]>): Promise<number> {
        const tableName = table as string;
        const { sql: whereSql, params } = buildWhereClause(query);
        const sql = `DELETE FROM "${tableName}"${whereSql ? ` WHERE ${whereSql}` : ''}`;
        const result = await this.run(sql, params);
        return result.changes ?? 0;
    }

    async upsert<K extends keyof Tables>(table: K, data: Partial<Tables[K]>[], key: keyof Tables[K] | (keyof Tables[K])[]): Promise<void> {
        const tableName = table as string;
        const keys = Object.keys(data[0]);
        const conflictKeys = (Array.isArray(key) ? key : [key]) as string[];
        const updateKeys = keys.filter(k => !conflictKeys.includes(k));

        const sql = `
            INSERT INTO "${tableName}" (${keys.map(k => `"${k}"`).join(', ')})
            VALUES (${keys.map(() => '?').join(', ')})
            ON CONFLICT (${conflictKeys.map(k => `"${k}"`).join(', ')}) DO UPDATE SET
            ${updateKeys.map(k => `"${k}" = excluded."${k}"`).join(', ')}
        `;

        await this.driver.exec('BEGIN');
        try {
            const stmt = await this.driver.prepare(sql);
            for (const item of data) {
                await stmt.run(keys.map(k => item[k as keyof typeof item]));
            }
            await stmt.finalize();
            await this.driver.exec('COMMIT');
        } catch (e) {
            await this.driver.exec('ROLLBACK');
            throw e;
        }
    }

    async drop<K extends keyof Tables>(table: K): Promise<void> {
        await this.run(`DROP TABLE IF EXISTS "${table as string}"`);
    }

    run(sql: string, params?: any[]): Promise<any> { return this.driver.run(sql, params); }
    get(sql: string, params?: any[]): Promise<any> { return this.driver.get(sql, params); }
    all(sql: string, params?: any[]): Promise<any[]> { return this.driver.all(sql, params); }
    async close(): Promise<void> {
        if (this.driver) {
            await this.driver.close();
            logger.info('Database connection closed.');
        }
    }
}

// --- Plugin Definition ---

export const config = {
    schema: {
        path: {
            type: 'string',
            default: 'data/database.db',
            description: '数据库文件地址'
        }
    } as Record<string, ConfigSchema>
};

export async function apply(ctx: Context, config: Config) {
    const dbPath = path.join(process.cwd(), config.get<string>('path', 'data/database.db'));
    const db = await SqliteDatabase.create(dbPath);
    ctx.registerComponent('database', db);
}

export async function disable(ctx: Context) {
    const db = ctx.getComponent('database');
    await db.close();
}