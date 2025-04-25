import { Core, Config, Session, Logger } from 'yumeri';
import * as fs from 'fs'; // 引入同步 fs 模块
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml'; // 引入 js-yaml

const logger = new Logger("console");

export const depend = ['server']; // 需要的服务
export const provide = ['console']; // 提供的服务

let loginstatus: Record<string, string> = {};

export async function apply(core: Core, config: Config) {
  core.command('console')
    .action(async (session: Session, param?: any) => {

      session.setMime('html'); // 默认设置为 HTML 类型
      if (param && param.path && !param.path.startsWith('/login') && !loginstatus[session.sessionid] && !param.path.startsWith('/api/loginpass')) {
        session.body = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>请先登录</title></head><body><script>window.onload = function() {alert("请先登录");window.location.href = "/console/login";};</script><p>正在重定向</p></body></html>`;
        return;
      }

      if (param && param.path && param.path.startsWith('/api/')) {
        const configYmlPath = path.join(process.cwd(), 'config.yml');
        const configTmpYmlPath = configYmlPath + '.tmp';

        try {
          const configFileContent = fs.readFileSync(configYmlPath, 'utf8');
          let configData: any = yaml.load(configFileContent); // 使用 js-yaml 解析 YAML 文件

          if (param.path === '/api/config') {
            const pluginName = param.name; // 获取插件名称
            if (!pluginName) {
              session.body = JSON.stringify({ error: 'Plugin name is required.' });
              session.setMime('json'); // API 响应应为 JSON
              return;
            } else {
              const pluginConfigObject = configData.plugins?.[pluginName];

              if (pluginConfigObject !== undefined && typeof pluginConfigObject === 'object' && !Array.isArray(pluginConfigObject)) {
                const pluginConfigArray = Object.keys(pluginConfigObject).map(key => ({ [key]: pluginConfigObject[key] }));
                session.body = JSON.stringify(pluginConfigArray);
              } else if (pluginConfigObject === undefined) {
                session.body = JSON.stringify({ error: `No configuration found for plugin: ${pluginName}` }); // 没有找到插件
              }
              else {
                logger.warn(`Configuration for plugin "${pluginName}" is not in the expected object format.`);
                session.body = JSON.stringify([]);
              }
            }
            session.setMime('json'); // API 响应应为 JSON
            return;

          } else if (param.path === '/api/getplugins') {
            const plugins = configData.plugins ? Object.keys(configData.plugins) : []; // 获取所有插件的名称 (对象键)
            session.body = JSON.stringify(plugins); // 将插件名称列表转换为 JSON 字符串
            session.setMime('json'); // API 响应应为 JSON
            return;
          } else if (param.path === '/api/setconfig') {
            // 保存插件配置 - 将前端发送的数组格式转换为后端期望的对象格式
            const pluginName = param.name; // 获取插件名称
            const content = param.content; // 获取配置内容 (期望是 JSON 字符串的数组)

            if (!pluginName || !content) {
              session.body = JSON.stringify({ error: 'Plugin name and content are required.' });
              session.setMime('json'); // API 响应应为 JSON
              return;
            } else {
              try {
                const newConfigArray = JSON.parse(content); // 解析 JSON 格式的配置内容 (期望是数组)

                // 验证 newConfigArray 是否是 数组
                if (!Array.isArray(newConfigArray)) {
                  session.body = JSON.stringify({ error: 'Content must be a valid JSON array.' });
                  session.setMime('json');
                  return;
                }

                // 将前端发送的数组格式 [{"key":"value"}, ...] 转换为后端期望的对象格式 {"key":"value", ...}
                const newConfigObject: { [key: string]: any } = {};
                for (const item of newConfigArray) {
                  // 验证数组里的每个元素是否是 object 且只有一个 key-value 对
                  const keys = Object.keys(item);
                  if (typeof item !== 'object' || item === null || keys.length !== 1) {
                    session.body = JSON.stringify({ error: 'Each item in the array must be a valid JSON object with a single key-value pair.' });
                    session.setMime('json');
                    return;
                  }
                  const key = keys[0];
                  newConfigObject[key] = item[key];
                }

                // 确保 plugins 对象存在，如果不存在则创建一个
                // 直接修改 configData，因为每次请求都重新加载了文件
                configData.plugins = configData.plugins || {};

                // 验证是否存在该插件，如果不存在则返回错误
                if (!configData.plugins.hasOwnProperty(pluginName)) {
                  session.body = JSON.stringify({ error: `No plugin found with name: ${pluginName}` }); // 没有找到插件
                  session.setMime('json');
                  return;
                }

                // 直接将转换后的对象赋给指定插件的配置

                configData.plugins[pluginName] = newConfigObject;
                //logger.info(`Updated config for plugin ${pluginName} with new config: ${JSON.stringify(newConfigObject)}`);


                const yamlStr = yaml.dump(configData, { // 使用修改后的 configData
                  indent: 2, // 缩进
                  lineWidth: 120, // 行宽
                  noRefs: true, // 禁用引用
                }); // 将 JavaScript 对象转换为 YAML 字符串

                // 先写入临时文件
                fs.writeFileSync(configTmpYmlPath, yamlStr, 'utf8');
                // 然后重命名覆盖原文件
                fs.renameSync(configTmpYmlPath, configYmlPath);

                //logger.info(`Configuration for plugin "${pluginName}" updated.`);
                session.body = JSON.stringify({ success: `Configuration for plugin ${pluginName} updated.` }); // 返回成功信息
                session.setMime('json'); // API 响应应为 JSON
                return; // 结束函数执行

              } catch (error: any) {
                // 捕获 JSON 解析错误或其他处理错误
                session.body = JSON.stringify({ error: `Error processing config update: ${error.message}` });
                console.error('Error processing config update:', error); // 记录详细错误日志
                session.setMime('json'); // API 响应应为 JSON
                return;
              }
            }
          } else {
          }
        } catch (error: any) {
          // 捕获文件读取或 YAML 解析错误
          session.body = JSON.stringify({ error: `Could not read or parse config.yml: ${error.message}` });
          console.error('Error reading/parsing config.yml:', error); // 记录详细错误日志
          session.setMime('json'); // API 响应应为 JSON
          return; // 结束函数执行
        }
        if (param.path === '/api/loginpass') {
          // 处理 login 路由
          //logger.info(param); // 记录请求参数
          if (param.username === config.content.adminname && param.password === config.content.adminpassword) {
            // 登录成功
            loginstatus[session.sessionid] = config.content.adminname;
            session.body = JSON.stringify({ success: '登录成功' });
            session.setMime('json'); // API 响应应为 JSON
          } else {
            // 登录失败
            session.body = JSON.stringify({ error: `账号或密码错误` });
            session.setMime('json'); // API 响应应为 JSON
            logger.info(param.username + '尝试登录');
          }
          return; // 结束函数执行
        }
        // 处理其他的 api 路由
        session.body = JSON.stringify({ error: `Unknown API path: ${param.path}` });
        session.setMime('json'); // API 响应应为 JSON
        return; // 结束函数执行
      }

      if (param && param.path) {
        const pluginDir = path.resolve(__dirname, '..');
        const filePath = path.join(pluginDir, 'static', param.path + '.html');

        try {
          // 将 fs.readFile 封装在一个 Promise 中以使用 await
          const htmlContent = await new Promise<string>((resolve, reject) => {
            fs.readFile(filePath, 'utf-8', (err, data: string) => {
              if (err) {
                reject(err); // 如果出错，Promise 状态变为 rejected
                return;
              }
              resolve(data); // 如果成功，Promise 状态变为 resolved
            });
          });

          let modifiedHtmlContent = htmlContent;
          if (param) {
            for (const key in param) {
              if (key !== 'path') {
                const regex = new RegExp(`{{ ${key} }}`, 'g');
                modifiedHtmlContent = modifiedHtmlContent.replace(regex, param);
              }
            }
          }

          session.body = modifiedHtmlContent; // 设置响应内容

        } catch (error: any) {
          session.body = `<h1>Error</h1><p>Could not read file: ${filePath}</p><p>${error.message}</p>`;
          console.error('读取文件出错:', error);
        }
      }
    });
}

export async function disable(core: Core) {
}