import { exec } from 'child_process';
import * as path from 'path'; // 即使不直接使用 path.join，也会经常在 Node.js 中用到，这里保留。

/**
 * 定义 npm list --json 命令输出中单个依赖项的结构。
 */
interface Dependency {
    version?: string; // 包的版本号
    resolved?: string; // 包的实际路径 (可选)
    from?: string;    // 来自哪里 (可选)
    dependencies?: { [key: string]: Dependency }; // 嵌套依赖
    [key: string]: any; // 允许其他未知属性
}

/**
 * 定义 npm list --json 命令整体输出的结构。
 */
interface NpmListOutput {
    version: string; // 项目自身的版本
    name: string;    // 项目名称
    dependencies?: { [key: string]: Dependency }; // 顶级依赖
    problems?: string[]; // 可能存在的安装问题
}

/**
 * 递归函数：遍历依赖树查找指定包的版本。
 * @param dependencies - 当前层次的依赖对象。
 * @param packageName - 要查找的包的名称。
 * @returns {string | null} 找到的包的版本号或 null。
 */
function findVersionInDependencies(dependencies: { [key: string]: Dependency } | undefined, packageName: string): string | null {
    if (!dependencies) {
        return null;
    }

    if (dependencies[packageName] && dependencies[packageName].version) {
        return dependencies[packageName].version;
    }

    for (const key in dependencies) {
        if (Object.prototype.hasOwnProperty.call(dependencies, key)) {
            const dep = dependencies[key];
            if (dep && dep.dependencies) {
                const found = findVersionInDependencies(dep.dependencies, packageName);
                if (found) {
                    return found;
                }
            }
        }
    }
    return null;
}

/**
 * 解析 `npm list --json` 的输出以提取指定包的版本。
 * @param stdout - `npm list --json` 命令的标准输出字符串。
 * @param packageName - 要查找的包的名称。
 * @returns {string | null} 包的版本号或 null。
 */
function parseNpmListOutput(stdout: string, packageName: string): string | null {
    try {
        const result: NpmListOutput = JSON.parse(stdout);

        // 如果 result 自身就是查询的包 (例如 `npm list vue --json` 在一个 vue 项目里运行)，
        // 并且 result.name === packageName，此时 result.version 就是对应版本。
        if (result.name === packageName && result.version) {
            return result.version;
        }

        return findVersionInDependencies(result.dependencies, packageName);
    } catch (parseError: any) {
        // console.error(`解析 npm list 输出失败: ${(parseError as Error).message}`);
        // console.error('原始输出 (可能为空或非JSON):', stdout);
        return null; // 解析失败意味着无法获取版本
    }
}

/**
 * 辅助函数：执行 shell 命令并返回 Promise。
 * @param cmd - 要执行的命令。
 * @param cwd - 命令的执行目录。
 * @returns {Promise<{stdout: string, stderr: string}>} Promise，解析为 stdout 和 stderr。
 */
function executeCommand(cmd: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        exec(cmd, { cwd }, (error, stdout, stderr) => {
            // if (error) {
            //     // 将 error 和 stderr 一起拒绝，方便调用方处理
            //     return reject(new Error(`Command failed: ${cmd}\nError: ${error.message}\nStderr: ${stderr}`));
            // }
            resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
        });
    });
}

/**
 * 获取指定包在当前项目或指定目录下的已安装版本号。
 * 该函数会执行 `npm list <package-name> --json` 命令来获取信息。
 *
 * @param {string} packageName - 要查询的包的名称。
 * @param {string} [dir=process.cwd()] - 项目的根目录路径，默认为当前工作目录 (`process.cwd()`)。
 * @returns {Promise<string|null>} 一个 Promise，解析为找到的包的版本号字符串；如果未找到包或发生错误，则解析为 null。
 */
export async function getSpecificPackageVersion(packageName: string, dir: string = process.cwd()): Promise<string | null> {
    // 尝试两种命令：先只查顶层依赖，如果没找到再查整个依赖树。
    // 这有助于处理在顶层依赖中不存在，但在嵌套依赖中存在的包。
    const commands = [
        `npm list ${packageName} --json --depth=0`, // 尝试在顶层依赖中快速查找
        `npm list ${packageName} --json`             // 如果未找到，进行完整依赖树搜索
    ];

    for (const command of commands) {
        // try {
        const { stdout, stderr } = await executeCommand(command, dir);
        const version = parseNpmListOutput(stdout, packageName);
        if (version) {
            return version; // 找到版本立即返回
        }
        // 如果 stdout 为空（即 `{}`），或者解析后没找到，npm list --json 也会退出码0
        // 但是如果 stderr 包含特定警告，且 stdout 为空，说明包可能确实没找到，可以提前退出循环。
        if (stdout.trim() === '{}' && stderr.includes('npm ERR! No matching version found for')) {
            return null; // 明确未找到包，直接返回 null
        }

        // } catch (error: any) {
        //     // exec rejection 表示命令执行本身有问题，比如 npm 未安装，或者路径无效。
        //     // 过滤掉 npm list 找不到包时的常见 stderr 错误，继续尝试下一个命令。
        //     const stderrContent = error.message.includes('Stderr: ') ? error.message.split('Stderr: ')[1].trim() : '';

        //     // 如果是 `npm ERR! code ELSPROBLEMS` 或 `npm ERR! No matching version found for`，
        //     // 通常表明命令执行成功，但结果是未找到包。此时继续尝试下一个命令。
        //     if (stderrContent.includes('npm ERR! code ELSPROBLEMS') || stderrContent.includes('npm ERR! No matching version found for')) {
        //         continue; // 继续尝试下一个命令
        //     } else {
        //         // 打印其他真正的致命错误，然后返回 null
        //         console.error(`执行 NPM 命令时发生致命错误: ${(error as Error).message}\n`);
        //         return null;
        //     }
        // }
    }

    return null; // 所有尝试后仍未找到
}

/**
 * 表示检测到的包管理器类型。
 */
export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'unknown';

/**
 * 获取当前启动项目所使用的包管理器。
 * 该函数通过检查 `process.env.npm_config_user_agent` 环境变量来确定。
 *
 * @returns {PackageManager} 检测到的包管理器名称 ('npm', 'yarn', 'pnpm')，
 *                          如果无法确定或不是通过包管理器启动，则返回 'unknown'。
 */
export function getPackageManager(): PackageManager {
    const userAgent = process.env.npm_config_user_agent;

    if (!userAgent) {
        return 'unknown';
    }

    // userAgent 示例:
    // npm: "npm/10.2.4 node/v20.11.1 win32 x64 workspaces/false"
    // yarn: "yarn/1.22.19 npm/? node/v20.11.1 win32 x64"
    // pnpm: "pnpm/8.15.4 npm/? node/v20.11.1 win32 x64"

    if (userAgent.includes('yarn')) {
        return 'yarn';
    }
    if (userAgent.includes('pnpm')) {
        return 'pnpm';
    }
    if (userAgent.includes('npm')) {
        // 'npm' 也会出现在 yarn 和 pnpm 的 userAgent 中，
        // 但我们已经先排除了 yarn 和 pnpm，所以这里就是纯粹的 npm。
        return 'npm';
    }

    return 'unknown';
}