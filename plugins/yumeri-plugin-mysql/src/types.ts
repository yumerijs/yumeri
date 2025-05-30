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

// 查询条件类型
export type ConditionValue = string | number | boolean | null | Date | (string | number | boolean | null | Date)[];

export interface QueryConditions {
    [key: string]: ConditionValue | QueryConditions | QueryOperator;
}

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

export interface ColumnAlteration {
    action: AlterColumnAction;
    field: string;
    definition?: ColumnDefinition; // for ADD/MODIFY
    oldFieldName?: string; // for CHANGE / RENAME (not implemented directly here, but conceptually)
}