/**
 * @time: 2025/05/24 12:18
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/ 

/**
 * 插件配置模式定义类
 * 用于描述插件配置项的类型、默认值、描述等信息
 */
export class ConfigSchema {
    /**
     * 配置项类型
     */
    public type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    
    /**
     * 默认值
     */
    public default?: any;
    
    /**
     * 配置项描述
     */
    public description?: string;
    
    /**
     * 是否必需
     */
    public required?: boolean;
    
    /**
     * 枚举值列表（可选项）
     */
    public enum?: any[];
    
    /**
     * 数组项类型定义（当type为array时使用）
     */
    public items?: ConfigSchema;
    
    /**
     * 对象属性定义（当type为object时使用）
     */
    public properties?: Record<string, ConfigSchema>;
  
    /**
     * 创建配置模式对象
     * @param type 配置项类型
     * @param options 配置项选项
     */
    constructor(
      type: 'string' | 'number' | 'boolean' | 'object' | 'array',
      options?: {
        default?: any;
        description?: string;
        required?: boolean;
        enum?: any[];
        items?: ConfigSchema;
        properties?: Record<string, ConfigSchema>;
      }
    ) {
      this.type = type;
      
      if (options) {
        this.default = options.default;
        this.description = options.description;
        this.required = options.required;
        this.enum = options.enum;
        this.items = options.items;
        this.properties = options.properties;
      }
    }
    
    /**
     * 创建字符串类型配置模式
     * @param options 配置项选项
     * @returns 配置模式对象
     */
    public static string(options?: Omit<ConfigSchema, 'type' | 'items' | 'properties'>): ConfigSchema {
      return new ConfigSchema('string', options);
    }
    
    /**
     * 创建数字类型配置模式
     * @param options 配置项选项
     * @returns 配置模式对象
     */
    public static number(options?: Omit<ConfigSchema, 'type' | 'items' | 'properties'>): ConfigSchema {
      return new ConfigSchema('number', options);
    }
    
    /**
     * 创建布尔类型配置模式
     * @param options 配置项选项
     * @returns 配置模式对象
     */
    public static boolean(options?: Omit<ConfigSchema, 'type' | 'items' | 'properties'>): ConfigSchema {
      return new ConfigSchema('boolean', options);
    }
    
    /**
     * 创建对象类型配置模式
     * @param properties 对象属性定义
     * @param options 配置项选项
     * @returns 配置模式对象
     */
    public static object(
      properties: Record<string, ConfigSchema>,
      options?: Omit<ConfigSchema, 'type' | 'items' | 'properties'>
    ): ConfigSchema {
      return new ConfigSchema('object', { ...options, properties });
    }
    
    /**
     * 创建数组类型配置模式
     * @param items 数组项类型定义
     * @param options 配置项选项
     * @returns 配置模式对象
     */
    public static array(
      items: ConfigSchema,
      options?: Omit<ConfigSchema, 'type' | 'items' | 'properties'>
    ): ConfigSchema {
      return new ConfigSchema('array', { ...options, items });
    }
    
    /**
     * 验证值是否符合配置模式
     * @param value 要验证的值
     * @returns 验证结果，如果通过返回true，否则返回错误信息
     */
    // public validate(value: any): true | string {
    //   // 检查必需项
    //   if (this.required && value === undefined) {
    //     return `Missing required value`;
    //   }
      
    //   // 如果值存在，检查类型
    //   if (value !== undefined) {
    //     // 类型检查
    //     switch (this.type) {
    //       case 'string':
    //         if (typeof value !== 'string') {
    //           return `Value should be string`;
    //         }
    //         break;
    //       case 'number':
    //         if (typeof value !== 'number') {
    //           return `Value should be number`;
    //         }
    //         break;
    //       case 'boolean':
    //         if (typeof value !== 'boolean') {
    //           return `Value should be boolean`;
    //         }
    //         break;
    //       case 'object':
    //         if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    //           return `Value should be object`;
    //         }
            
    //         // 如果有属性定义，检查每个属性
    //         if (this.properties) {
    //           for (const key in this.properties) {
    //             const propSchema = this.properties[key];
    //             const propValue = value[key];
                
    //             const propResult = propSchema.validate(propValue);
    //             if (propResult !== true) {
    //               return `Property ${key}: ${propResult}`;
    //             }
    //           }
    //         }
    //         break;
    //       case 'array':
    //         if (!Array.isArray(value)) {
    //           return `Value should be array`;
    //         }
            
    //         // 如果有数组项定义，检查每个项
    //         if (this.items) {
    //           for (let i = 0; i < value.length; i++) {
    //             const itemResult = this.items.validate(value[i]);
    //             if (itemResult !== true) {
    //               return `Item at index ${i}: ${itemResult}`;
    //             }
    //           }
    //         }
    //         break;
    //     }
        
    //     // 枚举值检查
    //     if (this.enum && !this.enum.includes(value)) {
    //       return `Value should be one of: ${this.enum.join(', ')}`;
    //     }
    //   }
      
    //   return true;
    // }
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
      // public validate(): true | string {
      //     if (!this.schema) {
      //         return true; // 没有schema，视为验证通过
      //     }
          
      //     for (const key in this.schema) {
      //         const schemaItem = this.schema[key];
      //         const value = this.content[key];
              
      //         const result = schemaItem.validate(value);
      //         if (result !== true) {
      //             return `Config ${key}: ${result}`;
      //         }
      //     }
          
      //     return true;
      // }
  }