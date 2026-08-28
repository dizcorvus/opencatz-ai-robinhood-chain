export interface ApiKeyPool {
  readonly baseVar: string;
  readonly keys: string[];
  readonly size: number;
  get(): string | undefined;
  markFailed(reason: string): string | undefined;
  reset(): void;
  getMaskedList(): string[];
}

const PLACEHOLDER_RE = /YOUR_|placeholder|mock/i;

export function createApiKeyPool(baseVar: string, keys: string[]): ApiKeyPool {
  const clean = keys
    .flatMap((k) => (typeof k === 'string' ? k.split(',') : []))
    .map((k) => k.trim())
    .filter((k) => k && !PLACEHOLDER_RE.test(k));
  let index = 0;
  let failed = new Set<number>();

  return {
    baseVar,
    keys: clean,
    size: clean.length,
    get(): string | undefined {
      return clean[index] ?? undefined;
    },
    markFailed(reason: string): string | undefined {
      if (clean.length <= 1) return clean[0] ?? undefined;
      failed.add(index);
      if (failed.size >= clean.length) {
        failed = new Set();
        console.warn(`[API KEY POOL] ${baseVar}: all keys failed — rotation reset.`);
      }
      let next = index;
      do {
        next = (next + 1) % clean.length;
      } while (failed.has(next) && failed.size < clean.length);
      index = next;
      console.warn(`[API KEY POOL] ${baseVar}: rotating to key #${index + 1}/${clean.length} (${reason}).`);
      return clean[index] ?? undefined;
    },
    reset(): void {
      failed = new Set();
      index = 0;
    },
    getMaskedList(): string[] {
      return clean.map((k, i) => {
        const masked = k.length > 8 ? `${k.slice(0, 4)}...${k.slice(-4)}` : `${k.slice(0, 2)}***`;
        return `#${i + 1}: ${masked}${i === index ? ' (active)' : ''}`;
      });
    },
  };
}

export function loadApiKeyPool(baseVar: string, aliases: string[] = []): ApiKeyPool {
  const candidates: string[] = [];
  const primaryKeys = [baseVar, ...aliases];

  for (const varName of primaryKeys) {
    const val = process.env[varName];
    if (val) candidates.push(val);
  }

  // Backup key patterns:
  // e.g. GMGN_API_KEY -> GMGN_API_KEY_BACKUP_KEYS, GMGN_BACKUP_KEYS
  const backupPatterns = [
    `${baseVar}_BACKUP_KEYS`,
    `${baseVar.replace(/_API_KEY$/, '')}_BACKUP_KEYS`,
    `${baseVar.replace(/_KEY$/, '')}_BACKUP_KEYS`,
    `${baseVar.replace(/_TOKEN$/, '')}_BACKUP_KEYS`,
    ...aliases.map((a) => `${a}_BACKUP_KEYS`),
    ...aliases.map((a) => `${a.replace(/_API_KEY$/, '')}_BACKUP_KEYS`),
  ];

  for (const backupVar of backupPatterns) {
    const val = process.env[backupVar];
    if (val) candidates.push(val);
  }

  return createApiKeyPool(baseVar, candidates);
}
