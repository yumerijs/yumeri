import fs from 'fs';
import crypto from 'crypto';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { transformSync } from 'esbuild';

let vueLoaderRegistered = false;

const SUPPORTED_ESBUILD_LOADERS = new Set(['js', 'ts', 'tsx', 'jsx'] as const);

function getScopeId(filename: string): string {
  return crypto.createHash('md5').update(filename).digest('hex').slice(0, 8);
}

function inferLoader(lang?: string): 'js' | 'ts' | 'tsx' | 'jsx' {
  if (!lang) return 'js';
  return SUPPORTED_ESBUILD_LOADERS.has(lang as any) ? (lang as any) : 'js';
}

export function registerVueRuntimeLoader(): void {
  if (vueLoaderRegistered) {
    return;
  }
  vueLoaderRegistered = true;

  require.extensions['.vue'] = function registerVueSFC(module: NodeModule, filename: string) {
    const nodeModule = module as NodeModule & { _compile(code: string, filename: string): void };

    try {
      const source = fs.readFileSync(filename, 'utf8');
      const { descriptor } = parse(source, { filename });

      if (!descriptor.script && !descriptor.scriptSetup && !descriptor.template) {
        nodeModule._compile('module.exports = {};\n', filename);
        return;
      }

      const id = getScopeId(filename);
      let code = '';
      const lang = descriptor.scriptSetup?.lang || descriptor.script?.lang;

      if (!descriptor.script && !descriptor.scriptSetup && descriptor.template) {
        const templateResult = compileTemplate({
          id,
          filename,
          source: descriptor.template.content,
          ssr: true
        });
        code = `
import { defineComponent } from 'vue';
${templateResult.code}

const __component__ = defineComponent({});
__component__.ssrRender = ssrRender;

export default __component__;
`;
      } else {
        const compiled = compileScript(descriptor, {
          id,
          inlineTemplate: Boolean(descriptor.template),
          templateOptions: {
            ssr: true
          }
        });
        code = compiled.content;
      }

      const transformed = transformSync(code, {
        loader: inferLoader(lang),
        format: 'cjs',
        target: 'node18',
        sourcemap: 'inline',
        sourcefile: filename
      });

      const metadataCode = `
const __yumeri_raw__ = module.exports && module.exports.__esModule ? module.exports.default : module.exports;
const __yumeri_target__ = typeof __yumeri_raw__ === 'function' || (typeof __yumeri_raw__ === 'object' && __yumeri_raw__ !== null)
  ? __yumeri_raw__
  : null;
if (__yumeri_target__) {
  Object.defineProperty(__yumeri_target__, '__file', {
    value: ${JSON.stringify(filename)},
    enumerable: false,
    configurable: true,
    writable: true,
  });
}
`;

      nodeModule._compile(`${transformed.code}\n${metadataCode}`, filename);
    } catch (error) {
      const friendlyMessage = new Error(
        `[yumeri] Failed to compile Vue SFC "${filename}". ` +
        `Make sure @vue/compiler-sfc can parse the file. Original error: ${(error as Error).message}`
      );
      friendlyMessage.stack = (error as Error).stack;
      throw friendlyMessage;
    }
  };
}
