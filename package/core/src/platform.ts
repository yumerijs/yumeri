/**
 * @time: 2025/08/14 09:48
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/
import { Session } from './session'
import { Core } from './core'
import { ConfigSchema } from './config'

/**
 * Platform 基类
 * 作为平台接入的基础类，提供标准化的接口和通用能力
 * 各平台实现类需继承此类并实现所有抽象方法
 */
export abstract class Platform {
    // 平台状态
    protected status: 'idle' | 'starting' | 'running' | 'stopping' | 'error' = 'idle';
    // 平台错误信息
    protected errorMessage: string | null = null;
    // 平台配置
    protected config: Record<string, any> = {};
    // 平台实例ID
    protected instanceId: string = '';
    // 平台事件监听器
    protected eventListeners: Record<string, Array<(...args: any[]) => void>> = {};

    /**
     * 构造函数
     * @param config 平台配置
     */
    constructor(config?: Record<string, any>) {
        if (config) {
            this.config = { ...config };
        }
        this.instanceId = this.generateInstanceId();
    }

    /**
     * 生成平台实例ID
     * @returns 实例ID字符串
     */
    protected generateInstanceId(): string {
        return `${this.getPlatformId()}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    }

    /**
     * 向客户端发送消息
     * @param session 会话对象
     * @param data 要发送的数据
     * @returns 发送结果
     */
    public abstract sendMessage(session: Session, data: any): any;

    /**
     * 结束会话
     * @param session 会话对象
     * @param message 结束消息
     * @returns 结束结果
     */
    public abstract terminationSession(session: Session, message: any): any;

    /**
     * 获取平台名称
     * @returns 平台名称
     */
    public abstract getPlatformName(): string;

    /**
     * 获取平台版本号
     * @returns 平台版本号
     */
    public abstract getPlatformVersionCode(): string;

    /**
     * 获取平台ID
     * @returns 平台ID
     */
    public abstract getPlatformId(): string;

    /**
     * 获取平台状态
     * @returns 平台状态对象
     */
    public abstract getPlatformStatus(): Record<string, any>;

    /**
     * 启动平台
     * @param core Core实例
     * @returns 启动结果
     */
    public abstract startPlatform(core?: Core): Promise<any>;

    /**
     * 停止平台
     * @returns 停止结果
     */
    public abstract stopPlatform(): Promise<void>;

    /**
     * 重启平台
     * @param core Core实例
     * @returns 重启结果
     */
    public async restartPlatform(core?: Core): Promise<any> {
        await this.stopPlatform();
        return this.startPlatform(core);
    }

    /**
     * 设置平台配置
     * @param key 配置键
     * @param value 配置值
     */
    public setConfig(key: string, value: any): void {
        this.config[key] = value;
    }

    /**
     * 获取平台配置
     * @param key 配置键
     * @param defaultValue 默认值
     * @returns 配置值
     */
    public getConfig<T>(key: string, defaultValue?: T): T {
        return (this.config[key] !== undefined) ? this.config[key] : defaultValue as T;
    }

    /**
     * 获取平台实例ID
     * @returns 实例ID
     */
    public getInstanceId(): string {
        return this.instanceId;
    }

    /**
     * 获取当前平台状态
     * @returns 状态字符串
     */
    public getStatus(): 'idle' | 'starting' | 'running' | 'stopping' | 'error' {
        return this.status;
    }

    /**
     * 获取错误信息
     * @returns 错误信息
     */
    public getErrorMessage(): string | null {
        return this.errorMessage;
    }

    /**
     * 添加平台事件监听器
     * @param event 事件名称
     * @param listener 监听器函数
     */
    public on(event: string, listener: (...args: any[]) => void): void {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event].push(listener);
    }

    /**
     * 移除平台事件监听器
     * @param event 事件名称
     * @param listener 监听器函数
     */
    public off(event: string, listener: (...args: any[]) => void): void {
        if (!this.eventListeners[event]) {
            return;
        }
        this.eventListeners[event] = this.eventListeners[event].filter(l => l !== listener);
    }

    /**
     * 触发平台事件
     * @param event 事件名称
     * @param args 事件参数
     */
    protected emit(event: string, ...args: any[]): void {
        if (!this.eventListeners[event]) {
            return;
        }
        for (const listener of this.eventListeners[event]) {
            try {
                listener(...args);
            } catch (error) {
                console.error(`Error in platform event listener for "${event}":`, error);
            }
        }
    }

    /**
     * 创建会话
     * @param ip 客户端IP
     * @param cookie Cookie对象
     * @param query 查询参数
     * @returns 会话对象
     */
    public createSession(ip: string, cookie: Record<string, string>, query?: Record<string, string>): Session {
        return new Session(ip, cookie, this, query);
    }

    /**
     * 处理会话数据
     * @param session 会话对象
     * @param data 会话数据
     * @returns 处理结果
     */
    public processSessionData(session: Session, data: any): any {
        // 默认实现，子类可覆盖
        return data;
    }

    /**
     * 验证会话
     * @param session 会话对象
     * @returns 验证结果
     */
    public validateSession(session: Session): boolean {
        // 默认实现，子类可覆盖
        return true;
    }

    /**
     * 获取平台支持的MIME类型
     * @returns MIME类型数组
     */
    public getSupportedMimeTypes(): string[] {
        // 默认实现，子类可覆盖
        return [
            'text/plain',
            'text/html',
            'application/json',
            'application/xml',
            'image/png',
            'image/jpeg',
            'application/pdf'
        ];
    }

    /**
     * 获取平台元数据
     * @returns 平台元数据
     */
    public getMetadata(): Record<string, any> {
        return {
            id: this.getPlatformId(),
            name: this.getPlatformName(),
            version: this.getPlatformVersionCode(),
            status: this.getStatus(),
            instanceId: this.getInstanceId(),
            supportedMimeTypes: this.getSupportedMimeTypes(),
            ...this.getPlatformStatus()
        };
    }
    
    /**
     * 获取平台配置模式
     * 子类可以覆盖此方法提供自定义配置模式
     * @returns 配置模式对象
     */
    public static getConfigSchema(): Record<string, ConfigSchema> {
        return {};
    }
}
