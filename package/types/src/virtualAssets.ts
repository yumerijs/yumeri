export interface VirtualAssetResponse {
  body: string | Buffer;
  contentType: string;
  headers?: Record<string, string>;
}

export type VirtualAssetResolver =
  | ((pathname: string) => Promise<VirtualAssetResponse | null> | VirtualAssetResponse | null);

const resolvers = new Set<VirtualAssetResolver>();

export function registerVirtualAssetResolver(resolver: VirtualAssetResolver): () => void {
  resolvers.add(resolver);
  return () => resolvers.delete(resolver);
}

export async function resolveVirtualAsset(pathname: string): Promise<VirtualAssetResponse | null> {
  for (const resolver of Array.from(resolvers)) {
    try {
      const result = resolver(pathname);
      if (!result) continue;
      if (result instanceof Promise) {
        const awaited = await result;
        if (awaited) return awaited;
      } else {
        return result;
      }
    } catch (error) {
      console.error('[yumeri][virtual-asset] Resolver error:', error);
    }
  }
  return null;
}
