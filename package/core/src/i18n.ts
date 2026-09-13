/**
 * @time: 2025/10/28 22:13
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/

type I18nData = Record<string, Record<string, string>> // key -> lang -> text

export class I18n {
  private data: I18nData = {}
  private fallback: string[]

  constructor(fallback: string[] = ['en']) {
    this.fallback = fallback
  }

  register(key: string | Record<string, any>, lang?: Record<string, string>) {
    if (typeof key === 'string' && lang) {
      if (!this.data[key]) this.data[key] = {}
      Object.assign(this.data[key], lang)
    } else if (typeof key === 'object') {
      this.flattenAndRegister(key)
    }
  }

  setFallback(fallback: string[]) {
    this.fallback = fallback
  }

  /**
   * 判断一个值是否是语言表，即 `{ zh: '...', en: '...' }` 这种值全为字符串的对象。
   * 这里不硬编码具体语言码，因为 fallback 列表可由 coreConfig.lang 配置。
   */
  private isLocaleMap(value: any): value is Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const values = Object.values(value)
    return values.length > 0 && values.every(v => typeof v === 'string')
  }

  private flattenAndRegister(obj: Record<string, any>, prefix = '') {
    for (const [k, v] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${k}` : k
      if (this.isLocaleMap(v)) {
        if (!this.data[fullKey]) this.data[fullKey] = {}
        Object.assign(this.data[fullKey], v)
      } else if (v && typeof v === 'object') {
        this.flattenAndRegister(v, fullKey)
      }
    }
  }

  isRegistered(key: string) {
    return !!this.data[key]
  }

  delete(key: string) {
    delete this.data[key]
  }

  /**
   * 获取指定key的翻译
   * @param key 文本点
   * @param langs 用户的语言优先级数组
   */
  get(key: string, langs?: string[]): string {
    const entry = this.data[key]
    if (!entry) return key

    if (langs && langs.length) {
      for (const l of langs) {
        if (entry[l]) return entry[l]
      }
    }

    for (const fb of this.fallback) {
      if (entry[fb]) return entry[fb]
    }

    return key
  }

  /**
   * 替换模板字符串中的文本点
   * e.g. "Hello {{app.title}}" -> "Hello 世界"
   */
  replaceAll(
    input: string,
    langs?: string[],
    customRegex?: RegExp
  ): string {
    const regex = customRegex || /\{\{\s*([\w.]+)\s*\}\}/g;
    return input.replace(regex, (_, key) => this.get(key.trim(), langs));
  }

  all() {
    return this.data
  }
}