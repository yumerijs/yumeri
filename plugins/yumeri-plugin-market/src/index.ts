import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import { getSpecificPackageVersion, getPackageManager, PackageManager } from './util';
import { exec } from 'child_process';
import path from 'path';

const logger = new Logger("market");

export const depend = ['console']; // 需要的服务

interface OperateConsole {
    addconsoleitem: (name: string, icon: string, displayname: string, htmlpath: string, staticpath: string) => void;

    /**
     * 移除一个控制台项。
     * @param name 要移除的控制台项的名称。
     */
    removeconsoleitem: (name: string) => void;

    /**
     * 获取指定会话的登录状态。
     * @param session 会话对象，包含 sessionid。
     * @returns 如果该会话已登录则返回 true，否则返回 false。
     */
    getloginstatus: (session: Session) => boolean;
}

export const config = {
    schema: {
        url: {
            type: 'string',
            default: 'https://yumeri.flweb.cn/registry.json',
            description: '插件市场 Registry 地址'
        },
        npmregistry: {
            type: 'string',
            default: 'https://registry.npmmirror.com',
            description: 'npm Registry 地址'
        }
    } as Record<string, ConfigSchema>
};

interface PluginInfo {
    name: string;
    description: string;
    version: string;
    author: string;
    unpackedSize: string;
    updatedAt: string;
    keywords: string[];
}

async function fetchPluginsDataFromUrl(url: string): Promise<PluginInfo[] | null> {
    try {
        logger.info(`尝试从URL: ${url} 获取数据...`);
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP 错误! 状态码: ${response.status} - ${response.statusText}`);
        }

        const data: PluginInfo[] = await response.json();

        return data;
    } catch (error) {
        if (error instanceof Error) {
            console.error(`从URL获取或解析JSON数据时发生错误: ${error.message}`);
            if (error.message.includes('fetch failed')) {
                logger.error(`提示: 可能是网络问题或URL不正确。请检查您的网络连接或URL。`);
            } else if (error.message.includes('JSON')) {
                logger.error(`提示: URL返回的内容可能不是有效的JSON格式。`);
            }
        } else {
            logger.error(`发生未知错误: ${error}`);
        }
        return null;
    }
}

export async function apply(ctx: Context, config: Config) {

    const console: OperateConsole = ctx.getComponent('console');
    // 注册Echo命令
    ctx.command('market')
        .action(async (session: Session, param?: any) => {
            if (console.getloginstatus(session)) {
                if (param.path === '/list') {
                    const plugins = await fetchPluginsDataFromUrl(config.get<string>('url', 'https://yumeri.flweb.cn/registry.json'));
                    if (plugins) {
                        session.body = JSON.stringify(plugins);
                    } else {
                        session.body = JSON.stringify({ success: false, message: 'Failed to fetch plugins' });
                    }
                } else if (param.path === '/search') {
                    const content = param.q;
                    const pluginsData = await fetchPluginsDataFromUrl(config.get<string>('url', 'https://yumeri.flweb.cn/registry.json'));
                    if (pluginsData) {
                        const filteredPlugins = pluginsData.filter(plugin => plugin.name.toLowerCase().includes(content.toLowerCase()));
                        session.body = JSON.stringify(filteredPlugins);
                        session.setMime('json')
                    }
                } else if (param.path === '/install') {
                    const packagename = param.name;
                    if (!packagename.includes('yumeri')) {
                        session.body = JSON.stringify({ success: false, message: 'Invalid package name' });
                    }
                    // 通过当前的包管理工具安装插件
                    const packageManager = getPackageManager();
                    if (packageManager === 'npm') {
                        await exec(`npm install ${packagename}`, (error, stdout, stderr) => {
                            logger.info(`${stdout}`);
                            logger.error(`${stderr}`);
                        });
                    } else if (packageManager === 'yarn') {
                        await exec(`yarn add ${packagename}`, (error, stdout, stderr) => {
                            logger.info(`${stdout}`);
                            logger.error(`${stderr}`);
                        });
                    } else if (packageManager === 'pnpm') {
                        await exec(`pnpm add ${packagename}`, (error, stdout, stderr) => {
                            logger.info(`${stdout}`);
                            logger.error(`${stderr}`);
                        });
                    } else {
                    }
                    session.body = JSON.stringify({ success: true });
                } else if (param.path === '/versions') {
                    const packagename = param.name;
                    if (!packagename.includes('yumeri')) {
                        session.body = JSON.stringify({ success: false, message: 'Invalid package name' });
                    }
                    // 从registry拉取版本列表，只筛选版本列表而不发送相关信息
                    const response = await fetch(`${config.get<string>('npmregistry', 'https://registry.npmmirror.com')}/${packagename}`);
                    if (response.ok) {
                        const data = await response.json();
                        session.body = JSON.stringify(data.versions);
                        session.setMime('json')
                    } else {
                        session.body = JSON.stringify({ success: false, message: 'Failed to fetch versions' });
                    }
                } else if (param.path === '/uninstall') {
                    const packagename = param.name;
                    if (!packagename.includes('yumeri')) {
                        session.body = 'Invalid package name';
                    }
                    // 卸载插件
                    const packageManager = getPackageManager();
                    if (packageManager === 'npm') {
                        await exec(`npm uninstall ${packagename}`, (error, stdout, stderr) => {
                            logger.info(`${stdout}`);
                            logger.error(`${stderr}`);
                        });
                    } else if (packageManager === 'yarn') {
                        await exec(`yarn remove ${packagename}`, (error, stdout, stderr) => {
                            logger.info(`${stdout}`);
                            logger.error(`${stderr}`);
                        });
                    } else if (packageManager === 'pnpm') {
                        await exec(`pnpm remove ${packagename}`, (error, stdout, stderr) => {
                            logger.info(`${stdout}`);
                            logger.error(`${stderr}`);
                        });
                    } else {
                    }
                    session.body = JSON.stringify({ success: true });
                } else if (param.path === '/currentver') {
                    // 返回当前项目内的包版本
                    const correntversion = await getSpecificPackageVersion(param.name);
                    session.body = correntversion;
                } else {
                    session.body = JSON.stringify({ success: false, message: '未知API请求' });
                }
                session.setMime('json')
            }
        });
    console.addconsoleitem('market', 'fa-plug', '插件市场', path.join(__dirname, '../static/index.html'), path.join(__dirname, '../static/'));
}
export function disable(ctx: Context) {
    // 当插件被禁用时执行的逻辑
    const console: OperateConsole = ctx.getComponent('console');
    console.removeconsoleitem('market');
}