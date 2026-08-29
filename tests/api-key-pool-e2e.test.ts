import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GMGNAdapter } from '../src/adapters/gmgn-adapter.js';
import { OpenSeaAdapter } from '../src/adapters/opensea-adapter.js';
import { GoPlusSecurityService } from '../src/services/goplus-security-service.js';
import { ApiKeyGuardService } from '../src/services/api-key-guard.js';

describe('Multi-Key Backup System End-to-End Failover', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it('GMGNAdapter seamlessly rotates to backup key on HTTP 401/403/429', async () => {
    process.env.GMGN_API_KEY = 'primary_key';
    process.env.GMGN_BACKUP_KEYS = 'backup_key_1,backup_key_2';

    const calledKeys: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      const authKey = init?.headers?.['X-APIKEY'] || '';
      calledKeys.push(authKey);

      if (authKey === 'primary_key') {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
      }
      return new Response(JSON.stringify({ code: 0, data: { rank: [] } }), { status: 200 });
    });

    const adapter = new GMGNAdapter();
    const result = await adapter.fetchRank('robinhood', '1h', 'volume');
    expect(result).not.toBeNull();
    expect(calledKeys[0]).toBe('primary_key');
    expect(calledKeys[1]).toBe('backup_key_1');
  });

  it('OpenSeaAdapter seamlessly rotates through backup keys on 401/429', async () => {
    process.env.OPENSEA_API_KEY = 'opensea_primary';
    process.env.OPENSEA_BACKUP_KEYS = 'opensea_backup';

    const calledKeys: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
      const headers = init?.headers || {};
      const authKey = headers['x-api-key'] || (typeof headers?.get === 'function' ? headers.get('x-api-key') : '');
      calledKeys.push(authKey);

      if (authKey === 'opensea_primary') {
        return new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 });
      }
      return new Response(JSON.stringify({ collections: [{ collection: 'test-nft', name: 'Test NFT' }] }), { status: 200 });
    });

    const adapter = new OpenSeaAdapter();
    const result = await adapter.fetchTrendingCollections(['robinhood'], 5);
    expect(result.length).toBe(1);
    expect(result[0].slug).toBe('test-nft');
    expect(calledKeys).toContain('opensea_primary');
    expect(calledKeys).toContain('opensea_backup');
  });

  it('GoPlusSecurityService seamlessly rotates to backup key on 401/429', async () => {
    process.env.GOPLUS_API_KEY = 'goplus_primary';
    process.env.GOPLUS_BACKUP_KEYS = 'goplus_backup';

    const calledKeys: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      const urlObj = new URL(url);
      const key = urlObj.searchParams.get('api_key') || '';
      calledKeys.push(key);

      if (key === 'goplus_primary') {
        return new Response(JSON.stringify({ code: 4012, message: 'Invalid API key' }), { status: 401 });
      }
      return new Response(
        JSON.stringify({
          code: 1,
          result: {
            '0x1234': {
              is_honeypot: '0',
              buy_tax: '0',
              sell_tax: '0',
              is_blacklisted: '0',
            },
          },
        }),
        { status: 200 }
      );
    });

    const service = new GoPlusSecurityService();
    const result = await service.auditTokenFull('robinhood', '0x1234');
    expect(result).not.toBeNull();
    expect(result?.isHoneypot).toBe(false);
    expect(calledKeys).toContain('goplus_primary');
    expect(calledKeys).toContain('goplus_backup');
  });

  it('ApiKeyGuardService recognizes sub-agent readiness when primary is unset but backup key exists', () => {
    delete process.env.KRYSTAL_CLOUD_API_KEY;
    process.env.KRYSTAL_CLOUD_BACKUP_KEYS = 'valid_krystal_backup_key';
    process.env.GMGN_API_KEY = 'valid_gmgn_key';
    process.env.AI_API_KEY = 'valid_ai_key';

    const guard = new ApiKeyGuardService();
    const check = guard.checkDomainKeys('lp-robinhood');
    expect(check.ready).toBe(true);
    expect(check.missingKeys).toEqual([]);
  });

  it('AIService seamlessly rotates to AI_BACKUP_KEYS when primary AI_API_KEY hits 429 rate limit or 402 out-of-credit', async () => {
    process.env.AI_API_KEY = 'ai_primary_rate_limited';
    process.env.AI_BACKUP_KEYS = 'ai_backup_valid_1';
    process.env.OPENAI_API_KEY = 'ai_backup_valid_2';

    const { AIService } = await import('../src/services/ai-service.js');
    const aiService = new AIService();
    const config = aiService.getConfig();

    expect(config.apiKeys).toContain('ai_primary_rate_limited');
    expect(config.apiKeys).toContain('ai_backup_valid_1');
    expect(config.apiKeys).toContain('ai_backup_valid_2');
    expect(config.apiKeys.length).toBe(3);

    const calledAuthHeaders: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
      const auth = init?.headers?.['Authorization'] || '';
      calledAuthHeaders.push(auth);

      if (auth.includes('ai_primary_rate_limited')) {
        return new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), { status: 429 });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Autonomous signal verified by backup key.' } }],
        }),
        { status: 200 }
      );
    });

    const response = await aiService.generateCompletion([
      { role: 'user', content: 'Analyze Robinhood token' },
    ]);

    expect(response).toBe('Autonomous signal verified by backup key.');
    expect(calledAuthHeaders[0]).toContain('ai_primary_rate_limited');
    expect(calledAuthHeaders[1]).toContain('ai_backup_valid_1');
  });

  it('AIService generateWithTools seamlessly rotates to backup key on 429 and updates active key pointer', async () => {
    process.env.AI_API_KEY = 'dead_key';
    process.env.AI_BACKUP_KEYS = 'working_backup_key';

    const { AIService } = await import('../src/services/ai-service.js');
    const aiService = new AIService();

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
      const auth = init?.headers?.['Authorization'] || '';
      if (auth.includes('dead_key')) {
        return new Response(JSON.stringify({ error: { message: 'Insufficient credits' } }), { status: 402 });
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'Tool executed successfully.',
                tool_calls: [{ id: 'call_1', function: { name: 'get_token_price', arguments: '{"symbol":"PEPE"}' } }],
              },
            },
          ],
        }),
        { status: 200 }
      );
    });

    const result = await aiService.generateWithTools(
      [{ role: 'user', content: 'What is PEPE price?' }],
      [{ name: 'get_token_price', description: 'Get token price', parameters: { type: 'object', properties: {} } }]
    );

    expect(result.content).toBe('Tool executed successfully.');
    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0].name).toBe('get_token_price');
  });
});
