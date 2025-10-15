import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import { getSpecificPackageVersion, getPackageManager, PackageManager } from './util';
import { exec, spawn } from 'child_process';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';

const logger = new Logger("market");

export const depend = ['console']; // 需要的服务
export const usage = `Yumeri 插件市场<br>由于插件市场的官方 Registry 是通过 Cloudflare Worker 部署的，可能会出现不稳定的情况<br>可在https://github.com/yumerijs/yumeri-tools找到Registry的部署文件然后自行部署`

interface OperateConsole {
    addconsoleitem: (name: string, icon: string, displayname: string, htmlpath: string, staticpath: string) => void;
    removeconsoleitem: (name: string) => void;
    getloginstatus: (session: Session) => boolean;
}

export const config = {
    schema: {
        url: {
            type: 'string',
            default: 'https://registry.yumeri.dev',
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
        if (!response.ok) throw new Error(`HTTP 错误! 状态码: ${response.status} - ${response.statusText}`);
        return await response.json();
    } catch (error) {
        logger.error(`从URL获取或解析JSON数据时发生错误: ${error instanceof Error ? error.message : error}`);
        return null;
    }
}

export async function apply(ctx: Context, config: Config) {
    const consoleApi: OperateConsole = ctx.getComponent('console');
    const requireLogin = (
        handler: (session: Session, params: URLSearchParams) => Promise<void>
    ) => {
        return async (session: Session, params: URLSearchParams) => {
            if (consoleApi.getloginstatus(session)) {
                await handler(session, params);
            } else {
                session.setMime('json');
                session.body = JSON.stringify({ success: false, message: '请先登录' });
            }
        };
    };


    const routes = {
        '/list': async (session: Session, params: URLSearchParams) => {
            const plugins = await fetchPluginsDataFromUrl(config.get<string>('url', 'https://registry.yumeri.dev'));
            session.body = JSON.stringify(plugins || { success: false, message: 'Failed to fetch plugins' });
        },
        '/search': async (session: Session, params: URLSearchParams) => {
            const content = params.get('q');
            if (!content) {
                session.body = JSON.stringify({ success: false, message: 'Missing search query' });
                return;
            }
            const pluginsData = await fetchPluginsDataFromUrl(config.get<string>('url', 'https://registry.yumeri.dev'));
            if (pluginsData) {
                const filteredPlugins = pluginsData.filter(plugin => plugin.name.toLowerCase().includes(content.toLowerCase()));
                session.body = JSON.stringify(filteredPlugins);
            }
        },
        '/install': async (session: Session, params: URLSearchParams) => {
            const packageName = params.get('name');
            const version = params.get('version');
            if (!packageName || !packageName.includes('yumeri')) {
                session.body = JSON.stringify({ success: false, message: 'Invalid package name' });
                return;
            }

            const packageJsonPath = path.resolve(process.cwd(), 'package.json');
            try {
                // 读取 package.json
                const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                pkg.dependencies ||= {};
                pkg.dependencies[packageName] = version;

                // 写回 package.json
                await fsp.writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');

                // 执行 yarn install
                await new Promise<void>((resolve, reject) => {
                    const child = spawn('yarn', ['install', `--registry=${config.get('npmregistry', 'https://registry.npmmirror.com')}`], { cwd: process.cwd() });
                    let stderr = '';
                    child.stdout.on('data', data => logger.info(data.toString()));
                    child.stderr.on('data', data => { logger.error(data.toString()); stderr += data.toString(); });
                    child.on('close', code => {
                        if (code !== 0) reject(new Error(stderr || 'Unknown error'));
                        else resolve();
                    });
                    child.on('error', err => reject(err));
                });

                session.body = JSON.stringify({ success: true, message: 'Installation successful' });
            } catch (e: any) {
                session.body = JSON.stringify({ success: false, message: e.message });
            }
        },
        '/versions': async (session: Session, params: URLSearchParams) => {
            const packageName = params.get('name');
            if (!packageName || !packageName.includes('yumeri')) {
                session.body = JSON.stringify({ success: false, message: 'Invalid package name' });
                return;
            }
            const response = await fetch(`${config.get<string>('npmregistry', 'https://registry.npmmirror.com')}/${packageName}`);
            if (response.ok) {
                const data = await response.json();
                session.body = JSON.stringify(data.versions);
            } else {
                session.body = JSON.stringify({ success: false, message: 'Failed to fetch versions' });
            }
        },
        '/uninstall': async (session: Session, params: URLSearchParams) => {
            const packageName = params.get('name');
            if (!packageName || !packageName.includes('yumeri')) {
                session.body = JSON.stringify({ success: false, message: 'Invalid package name' });
                return;
            }

            try {
                await new Promise<void>((resolve, reject) => {
                    const child = spawn('yarn', ['remove', packageName], { cwd: process.cwd() });
                    let stderr = '';

                    child.stdout.on('data', data => logger.info(data.toString()));
                    child.stderr.on('data', data => { logger.error(data.toString()); stderr += data.toString(); });

                    child.on('close', code => {
                        if (code !== 0) reject(new Error(stderr || 'Unknown error'));
                        else resolve();
                    });

                    child.on('error', err => reject(err));
                });

                session.body = JSON.stringify({ success: true, message: 'Uninstallation successful' });
            } catch (e: any) {
                session.body = JSON.stringify({ success: false, message: e.message });
            }
        },
        '/currentver': async (session: Session, params: URLSearchParams) => {
            const packageName = params.get('name');
            if (!packageName) {
                session.body = JSON.stringify({ success: false, message: 'Missing package name' });
                return;
            }
            const version = await getSpecificPackageVersion(packageName);
            session.body = JSON.stringify({ version: version });
        }
    };

    for (const [path, handler] of Object.entries(routes)) {
        ctx.route(`/api/market${path}`).action(
            requireLogin(async (sess, params) => {
                sess.setMime('json');
                await handler(sess, params);
            })
        );
    }


    consoleApi.addconsoleitem('market', 'fa-plug', '插件市场', path.join(__dirname, '../static/index.html'), path.join(__dirname, '../static/'));
}

export function disable(ctx: Context) {
    const consoleApi: OperateConsole = ctx.getComponent('console');
    consoleApi.removeconsoleitem('market');
}
