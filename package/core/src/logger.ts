/**
 * @time: 2025/03/25 18:01
 * @author: FireGuo
 * WindyPear-Team All right reserved
 */

import colors from 'ansi-colors'; // 引入 ansi-colors
import { Core } from './core';

export class Logger {
  private title: string;
  private titleColor: any;
  public static coreInstance: Core | null = null; 
  public static logs: string[] = [];
  public static setCore(core: Core) {
    if (Logger.coreInstance !== null) {
      const logger = new Logger('Logger');
      logger.warn("Logger.coreInstance is already set. Overwriting would cause confusion.");
    }
    Logger.coreInstance = core;
  }

  constructor(title: string) {
    this.title = title;
    this.titleColor = this.getRandomColor();
  }

  private getRandomColor() {
    const availableColors = [colors.red, colors.green, colors.yellow, colors.blue, colors.magenta, colors.cyan, colors.white, colors.gray];
    const randomIndex = Math.floor(Math.random() * availableColors.length);
    return availableColors[randomIndex];
  }

  private log(level: string, ...args: any[]) {
    const now = new Date();
    const timestamp = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    console.log(`${timestamp} [${level}] ${this.titleColor(this.title)} `, ...args);
    Logger.coreInstance?.emit('log', { level, message: args.join(' ') });
  }

  info(...args: any[]) {
    this.log('I', ...args);
  }

  warn(...args: any[]) {
    this.log('W', ...args);
  }

  error(...args: any[]) {
    this.log('E', ...args);
  }
}

function stringifyDebug(value: unknown, seen: WeakSet<object> = new WeakSet(), depth: number = 0, indent: number = 2, maxDepth: number = 5): string {
  const pad = ' '.repeat(depth * indent);
  const nextPad = ' '.repeat((depth + 1) * indent);

  // --- 1. 处理基本类型和 null ---
  if (value === null) {
      return 'null';
  }
  const type = typeof value;
  if (type === 'string') {
      // 确保 value 是字符串，并正确转义内部单引号
      return `'${(value as string).replace(/'/g, "\\'")}'`; 
  }
  if (type === 'number' || type === 'boolean') {
      return String(value);
  }
  if (type === 'undefined') {
      return 'undefined';
  }
  if (type === 'symbol') {
      return (value as Symbol).toString();
  }
  if (type === 'function') {
      // 类型断言，确保可以访问函数的 name 属性
      return `[Function: ${(value as Function).name || '(anonymous)'}]`;
  }
  if (type === 'bigint') {
      // BigInt 的特殊表示，确保 value 是 BigInt 类型
      return `${String(value as bigint)}n`;
  }

  // At this point, 'value' must be a non-primitive object type (object, array, Map, Set, Date, RegExp, custom class)

  // --- 2. 处理简单的内置对象 (它们不会有循环引用问题) ---
  if (value instanceof RegExp) {
      return value.toString();
  }
  if (value instanceof Date) {
      return value.toISOString();
  }

  // --- 3. 深度限制检查 ---
  // 此时 value 确定是一个可以被 seen WeakSet 存储的对象
  if (depth >= maxDepth) {
      return '[Object]';
  }

  // --- 4. 循环引用检测 ---
  // 将当前对象添加到 seen Set，以便在后续递归中检测循环引用
  // 这里需要断言 value 是一个 object 类型，因为 WeakSet 只能存储对象
  if (seen.has(value as object)) {
      return '[Circular]';
  }
  seen.add(value as object); // 添加到已访问集合

  // --- 5. 处理复杂内置对象 (Array, Map, Set) ---
  if (Array.isArray(value)) {
      // 在这一分支中，TypeScript 已经把 value 缩小为 unknown[] 类型
      if (value.length === 0) return '[]';
      const elements = value.map(el =>
          stringifyDebug(el, seen, depth + 1, indent, maxDepth)
      );
      return `[\n${nextPad}${elements.join(`,\n${nextPad}`)}\n${pad}]`;
  }

  if (value instanceof Map) {
      // 在这一分支中，TypeScript 已经把 value 缩小为 Map<unknown, unknown> 类型
      if (value.size === 0) return 'Map(0) {}';
      const entries = Array.from(value.entries()).map(([k, v]) =>
          `${stringifyDebug(k, seen, depth + 1, indent, maxDepth)} => ${stringifyDebug(v, seen, depth + 1, indent, maxDepth)}`
      );
      return `Map(${value.size}) {\n${nextPad}${entries.join(`,\n${nextPad}`)}\n${pad}}`;
  }

  if (value instanceof Set) {
      // 在这一分支中，TypeScript 已经把 value 缩小为 Set<unknown> 类型
      if (value.size === 0) return 'Set(0) {}';
      const elements = Array.from(value.values()).map(el =>
          stringifyDebug(el, seen, depth + 1, indent, maxDepth)
      );
      return `Set(${value.size}) {\n${nextPad}${elements.join(`,\n${nextPad}`)}\n${pad}}`;
  }

  // --- 6. 处理普通对象和自定义类的实例 ---
  // 此时，value 确定是一个对象 (除了上面已处理的 Array, Map, Set, Date, RegExp, primitive, null)
  // 并且它已经添加到了 seen 集合
  const keys = Object.keys(value as object); // 将 value 断言为 object，确保 Object.keys 可以接受

  // 获取构造函数名（如果不是普通的 Object）
  let constructorName = '';
  // 同样，确保 value 被视为 object 以访问 constructor 属性
  if ((value as object).constructor && (value as object).constructor.name && (value as object).constructor.name !== 'Object') {
      constructorName = `${(value as object).constructor.name} `;
  }

  if (keys.length === 0) {
      return `${constructorName}{}`; // 空对象/空类实例
  }

  const properties = keys.map(key => {
      // 将 value 断言为带有索引签名的 Record，以便可以通过字符串键访问属性
      const propValue = (value as Record<string, unknown>)[key]; 
      return `${nextPad}${normalizeObjectKey(key)}: ${stringifyDebug(propValue, seen, depth + 1, indent, maxDepth)}`;
  });

  return `${constructorName}{\n${properties.join(',\n')}\n${pad}}`;
}

// 辅助函数：格式化对象键名，确保它在字面量中是有效的
function normalizeObjectKey(key: string): string {
  // 检查 key 是否是有效的 JavaScript 标识符，且不是保留字
  // 简化的判断：如果包含非字母数字下划线，或以数字开头，则需要引用。
  // 更严谨的判断需要解析器级别的检查。这里我们简单处理为如果包含特殊字符或空格就引用。
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) && !['null', 'undefined', 'true', 'false'].includes(key)) {
      return key; // 不需要引用
  }
  // 引用并转义内部的单引号
  return `'${key.replace(/'/g, "\\'")}'`; 
}