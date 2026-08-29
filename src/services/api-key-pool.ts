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

  // Comprehensive backup key patterns:
  // e.g. GMGN_API_KEY -> GMGN_API_KEY_BACKUP_KEYS, GMGN_BACKUP_KEYS, GMGN_API_KEY_BACKUP, GMGN_BACKUP, GMGN_KEY_1..10
  const prefixes = [
    baseVar,
    baseVar.replace(/_API_KEY$/, ''),
    baseVar.replace(/_KEY$/, ''),
    baseVar.replace(/_TOKEN$/, ''),
    ...aliases,
    ...aliases.map((a) => a.replace(/_API_KEY$/, '')),
  ];

  const backupSuffixes = [
    '_BACKUP_KEYS',
    '_BACKUP_KEY',
    '_BACKUPS',
    '_BACKUP',
    '_KEYS',
  ];

  for (const prefix of prefixes) {
    for (const suffix of backupSuffixes) {
      const varName = `${prefix}${suffix}`;
      if (!primaryKeys.includes(varName)) {
        const val = process.env[varName];
        if (val) candidates.push(val);
      }
    }
    // Also check indexed slots: e.g. GMGN_KEY_1, GMGN_KEY_2, etc.
    for (let i = 1; i <= 10; i++) {
      const indexed = process.env[`${prefix}_${i}`] || process.env[`${prefix}_KEY_${i}`];
      if (indexed) candidates.push(indexed);
    }
  }

  return createApiKeyPool(baseVar, candidates);
}
