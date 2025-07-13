import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';

const logger = new Logger("{{name}}");

export const config = {} as Record<string, ConfigSchema>

export async function apply(ctx: Context, config: Config) {
  // TODO: Implement your logic here
}