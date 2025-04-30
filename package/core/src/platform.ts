import { Session } from './session'
import { Core } from './core'

export abstract class Platform {
    //内部接口抽象函数
    //发送内容
    public abstract sendMessage(session: Session, data: any): any;
    //结束会话
    public abstract terminationSession(session: Session, message: any): any;
    //获取平台名称
    public abstract getPlatformName(): string;
    //获取平台版本号
    public abstract getPlatformVersionCode(): string;
    //获取平台id
    public abstract getPlatformId(): string;
    //获取平台状态，返回Record
    public abstract getPlatformStatus(): any;
    //启动平台
    public abstract startPlatform(core?: Core): any;
}