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
  public static logs: { level: string; message: string, timestamp: string }[] = [];

  public static setCore(core: Core) {
    if (Logger.coreInstance !== null) {
      return
    }
    Logger.coreInstance = core;
  }

  constructor(title: string) {
    this.title = title;
    this.titleColor = this.getColorByName(this.title);
  }

  private getColorByName(name: string): (text: string) => string {
    const availableColors = [
      pc.red, pc.green, pc.yellow, pc.blue,
      pc.magenta, pc.cyan, pc.white,
      pc.redBright, pc.greenBright, pc.yellowBright, 
      pc.blueBright, pc.magentaBright, pc.cyanBright
    ];
    // Simple hash function to ensure consistent color for the same title
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash % availableColors.length);
    return availableColors[index];
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
    Logger.coreInstance?.emit('log', { level, message: args.join(' '), timestamp });
    Logger.logs.push({ level, message: args.join(' '), timestamp });
  }


  info(...args: any[]) { this.log('I', ...args); }
  warn(...args: any[]) { this.log('W', ...args); }
  error(...args: any[]) { this.log('E', ...args); }
}
