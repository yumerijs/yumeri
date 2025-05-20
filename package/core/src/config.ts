/**
 * @time: 2025/03/24 12:26
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/ 

/**
 * 插件配置模式定义接口
 */
export interface ConfigSchema {
  /**
   * 配置项类型
   */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  
  /**
   * 默认值
   */
  default?: any;
  
  /**
   * 配置项描述
   */
  description?: string;
  
  /**
   * 是否必需
   */
  required?: boolean;
  
  /**
   * 枚举值列表（可选项）
   */
  enum?: any[];
  
  /**
   * 数组项类型定义（当type为array时使用）
   */
  items?: ConfigSchema;
  
  /**
   * 对象属性定义（当type为object时使用）
   */
  properties?: Record<string, ConfigSchema>;
}

export class Config {
    /**
     * 配置名称
     */
    public name: string = '';
    
    /**
     * 配置内容
     */
    public content: { [name: string]: any } = {};
    
    /**
     * 配置模式
     */
    public schema?: Record<string, ConfigSchema>;

    /**
     * 创建配置对象
     * @param name 配置名称
     * @param content 配置内容
     * @param schema 配置模式
     */
    constructor(name: string, content?: { [name: string]: any }, schema?: Record<string, ConfigSchema>) {
        this.name = name;
        this.content = content || {}; // 如果 content 是 undefined，则赋值为空对象
        this.schema = schema;
    }
    
    /**
     * 获取配置项值
     * @param key 配置项键名
     * @param defaultValue 默认值
     * @returns 配置项值
     */
    public get<T>(key: string, defaultValue?: T): T {
        if (this.content[key] !== undefined) {
            return this.content[key] as T;
        }
        
        // 如果有schema，尝试从schema中获取默认值
        if (this.schema && this.schema[key] && this.schema[key].default !== undefined) {
            return this.schema[key].default as T;
        }
        
        return defaultValue as T;
    }
    
    /**
     * 设置配置项值
     * @param key 配置项键名
     * @param value 配置项值
     */
    public set(key: string, value: any): void {
        this.content[key] = value;
    }
    
    /**
     * 验证配置是否符合schema
     * @returns 验证结果，如果通过返回true，否则返回错误信息
     */
    public validate(): true | string {
        if (!this.schema) {
            return true; // 没有schema，视为验证通过
        }
        
        for (const key in this.schema) {
            const schemaItem = this.schema[key];
            
            // 检查必需项
            if (schemaItem.required && this.content[key] === undefined) {
                return `Missing required config: ${key}`;
            }
            
            // 如果配置项存在，检查类型
            if (this.content[key] !== undefined) {
                const value = this.content[key];
                
                // 类型检查
                switch (schemaItem.type) {
                    case 'string':
                        if (typeof value !== 'string') {
                            return `Config ${key} should be string`;
                        }
                        break;
                    case 'number':
                        if (typeof value !== 'number') {
                            return `Config ${key} should be number`;
                        }
                        break;
                    case 'boolean':
                        if (typeof value !== 'boolean') {
                            return `Config ${key} should be boolean`;
                        }
                        break;
                    case 'object':
                        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                            return `Config ${key} should be object`;
                        }
                        break;
                    case 'array':
                        if (!Array.isArray(value)) {
                            return `Config ${key} should be array`;
                        }
                        break;
                }
                
                // 枚举值检查
                if (schemaItem.enum && !schemaItem.enum.includes(value)) {
                    return `Config ${key} should be one of: ${schemaItem.enum.join(', ')}`;
                }
            }
        }
        
        return true;
    }
}
