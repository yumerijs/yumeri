import { Context, Logger, Session, Schema } from 'yumeri';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import mime from 'mime';
import 'yumeri-plugin-console'

const logger = new Logger("files");

export const depend = ['console'];

export interface FilesConfig {
  root: string;
}

export const config: Schema<FilesConfig> = Schema.object({
  root: Schema.string('文件管理的根目录 (默认为项目根目录)').default('.'),
});

export async function apply(ctx: Context, config: FilesConfig) {
    const consoleApi = ctx.component.console;

    if (!consoleApi) {
        logger.error('Console 插件不可用，文件管理无法加载。');
        return;
    }

    consoleApi.addconsoleitem(
        'files',
        'fa-folder-open',
        '文件管理',
        path.join(__dirname, '../static/index.html'),
        path.join(__dirname, '../static/')
    );

    const rootDir = config.root;
    const safeBaseDir = path.resolve(process.cwd(), rootDir);
    await fs.mkdir(safeBaseDir, { recursive: true });

    const resolveSecurePath = (userPath: string) => {
        if (typeof userPath !== 'string') {
            throw new Error('无效路径：必须是字符串。');
        }
        const resolvedPath = path.resolve(safeBaseDir, userPath);
        if (!resolvedPath.startsWith(safeBaseDir)) {
            throw new Error('禁止路径遍历攻击。');
        }
        return resolvedPath;
    };

    const handleError = (session: Session, error: any) => {
        logger.error(error);
        session.status = error.message.includes('禁止路径遍历') ? 403 : 500;
        session.body = JSON.stringify({ success: false, message: error.message || '发生未知错误。' });
        session.setMime('json');
    };

    // --- 鉴权中间件 ---
    const requireLogin = (action: (session: Session, params: URLSearchParams) => Promise<void>) => {
        return async (session: Session, params: URLSearchParams) => {
            if (!consoleApi.getloginstatus(session)) {
                session.status = 401;
                session.body = JSON.stringify({ success: false, message: '未登录或鉴权失败。' });
                session.setMime('json');
                return;
            }
            await action(session, params);
        };
    };

    ctx.route('/api/files/list').action(requireLogin(async (session, params) => {
        try {
            const userPath = params.get('path') || '.';
            const dirPath = resolveSecurePath(userPath);
            const dirents = await fs.readdir(dirPath, { withFileTypes: true });
            const files = await Promise.all(dirents.map(async (dirent) => {
                const direntPath = path.join(userPath, dirent.name);
                return {
                    name: dirent.name,
                    isDirectory: dirent.isDirectory(),
                    path: direntPath,
                };
            }));
            session.body = JSON.stringify(files);
            session.setMime('json');
        } catch (error) {
            handleError(session, error);
        }
    }));

    ctx.route('/api/files/read').action(requireLogin(async (session, params) => {
        try {
            const userPath = params.get('path');
            if (!userPath) throw new Error('必须提供 query 参数 \'path\'。');
            const filePath = resolveSecurePath(userPath);
            session.body = await fs.readFile(filePath, 'utf-8');
            session.setMime('text/plain');
        } catch (error) {
            handleError(session, error);
        }
    }));

    ctx.route('/api/files/download').action(requireLogin(async (session, params) => {
        try {
            const userPath = params.get('path');
            if (!userPath) throw new Error('必须提供 query 参数 \'path\'。');
            const filePath = resolveSecurePath(userPath);
            const fileName = path.basename(filePath);
            const mimeType = mime.getType(filePath) || 'application/octet-stream';

            session.head['Content-Disposition'] = `attachment; filename="${encodeURIComponent(fileName)}"`;
            session.setMime(mimeType);
            session.response(fsSync.createReadStream(filePath), 'stream');
        } catch (error) {
            handleError(session, error);
        }
    }));

    ctx.route('/api/files/write').action(requireLogin(async (session) => {
        try {
            const body = await session.parseRequestBody();
            const userPath = body?.path;
            const content = body?.content;

            if (typeof userPath !== 'string') throw new Error('请求体必须包含字符串类型的 \'path\'。');
            if (typeof content !== 'string') throw new Error('请求体必须包含字符串类型的 \'content\'。');

            const filePath = resolveSecurePath(userPath);
            await fs.writeFile(filePath, content, 'utf-8');
            session.body = JSON.stringify({ success: true });
            session.setMime('json');
        } catch (error) {
            handleError(session, error);
        }
    }));

    ctx.route('/api/files/create-dir').action(requireLogin(async (session) => {
        try {
            const body = await session.parseRequestBody();
            const userPath = body?.path;
            const name = body?.name;

            if (typeof userPath !== 'string') throw new Error('请求体必须包含字符串类型的 \'path\'。');
            if (typeof name !== 'string' || !name) throw new Error('请求体必须包含非空字符串类型的 \'name\'。');
            if (name.includes('/') || name.includes('..')) throw new Error('无效的文件夹名称。');

            const dirPath = resolveSecurePath(userPath);
            await fs.mkdir(path.join(dirPath, name));
            session.body = JSON.stringify({ success: true });
            session.setMime('json');
        } catch (error) {
            handleError(session, error);
        }
    }));

    logger.info('File Manager plugin loaded.');
}