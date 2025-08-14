/**
 * @time: 2025/08/14 09:48
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/

import pc from 'picocolors';
import { Core } from './core';

export class Logger {
  private title: string;
  private titleColor: (text: string) => string;
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

  private getRandomColor(): (text: string) => string {
    const availableColors = [
      pc.red, pc.green, pc.yellow, pc.blue,
      pc.magenta, pc.cyan, pc.white, pc.gray
    ];
    const randomIndex = Math.floor(Math.random() * availableColors.length);
    return availableColors[randomIndex];
  }

  private getTimestamp(): string {
    const now = new Date();
    return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ` +
      `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  }

  private log(level: string, ...args: any[]) {
    const levelColor = level === 'E' ? pc.red : level === 'W' ? pc.yellow : pc.cyan;
    const timestamp = this.getTimestamp();
    console.log(`${pc.gray(timestamp)} [${levelColor(level)}] ${this.titleColor(this.title)}`, ...args);
    Logger.coreInstance?.emit('log', { level, message: args.join(' ') });
  }


  info(...args: any[]) { this.log('I', ...args); }
  warn(...args: any[]) { this.log('W', ...args); }
  error(...args: any[]) { this.log('E', ...args); }
}
