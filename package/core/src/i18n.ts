/**
 * @time: 2025/10/27 23:05
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

  private flattenAndRegister(obj: Record<string, any>, prefix = '') {
    for (const [k, v] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${k}` : k
      if (typeof v === 'object' && !('zh' in v || 'en' in v)) {
        this.flattenAndRegister(v, fullKey)
      } else if (typeof v === 'object') {
        if (!this.data[fullKey]) this.data[fullKey] = {}
        Object.assign(this.data[fullKey], v)
      }
    }
  }

  isRegistered(key: string) {
    return !!this.data[key]
  }

  delete(key: string) {
    delete this.data[key]
  }

  get(key: string, lang: string): string {
    const entry = this.data[key]
    if (!entry) return key
    if (entry[lang]) return entry[lang]

    for (const fb of this.fallback) {
      if (entry[fb]) return entry[fb]
    }

    return key
  }

  replaceAll(input: string, lang: string): string {
    return input.replace(/\{\{(.*?)\}\}/g, (_, key) => this.get(key.trim(), lang))
  }

  all() {
    return this.data
  }
}