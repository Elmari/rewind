import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { PublicClientApplication, type Configuration, type ICachePlugin } from '@azure/msal-node';

export interface MsalAppConfig {
  tenant_id: string;
  client_id: string;
}

function tokenCachePath(): string {
  return join(homedir(), '.config', 'rewind', 'msal-cache.json');
}

function makeCachePlugin(): ICachePlugin {
  const path = tokenCachePath();
  return {
    async beforeCacheAccess(ctx) {
      if (existsSync(path)) {
        ctx.tokenCache.deserialize(readFileSync(path, 'utf8'));
      }
    },
    async afterCacheAccess(ctx) {
      if (ctx.cacheHasChanged) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, ctx.tokenCache.serialize(), 'utf8');
      }
    },
  };
}

export function buildMsalClient(cfg: MsalAppConfig): PublicClientApplication {
  const config: Configuration = {
    auth: {
      clientId: cfg.client_id,
      authority: `https://login.microsoftonline.com/${cfg.tenant_id}`,
    },
    cache: { cachePlugin: makeCachePlugin() },
  };
  return new PublicClientApplication(config);
}

export async function deviceCodeLogin(cfg: MsalAppConfig, scopes: string[], label: string): Promise<void> {
  const pca = buildMsalClient(cfg);
  await pca.acquireTokenByDeviceCode({
    scopes,
    deviceCodeCallback: (info) => {
      console.log(`\n=== ${label} Device Code Login ===`);
      console.log(info.message);
      console.log(`${'='.repeat(label.length + 24)}\n`);
    },
  });
}

export async function acquireGraphToken(cfg: MsalAppConfig, scopes: string[]): Promise<string> {
  const pca = buildMsalClient(cfg);
  const accounts = await pca.getTokenCache().getAllAccounts();
  if (accounts.length === 0) {
    throw new Error('No Microsoft account cached. Run `rewind login outlook` or `rewind login teams` first.');
  }
  const result = await pca.acquireTokenSilent({ account: accounts[0]!, scopes });
  if (!result?.accessToken) throw new Error('Failed to acquire Graph access token');
  return result.accessToken;
}
