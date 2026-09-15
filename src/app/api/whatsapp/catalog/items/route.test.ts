import { beforeEach, describe, expect, it, vi } from 'vitest';

// GET /api/whatsapp/catalog/items
//
// Guards:
//   - unauthenticated callers get 401 (via getCurrentAccount)
//   - catalog + items are scoped to the caller's account
//   - no catalog → `catalog: null`, empty items list

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return {
    ...actual,
    getCurrentAccount: mocks.getCurrentAccount,
  };
});

const { GET } = await import('./route');
const { UnauthorizedError } = await import('@/lib/auth/account');

function makeScopedClient(opts: {
  catalog?: Record<string, unknown> | null;
  items?: Record<string, unknown>[];
}) {
  const calls: string[] = [];

  /** Chainable + thenable query stub. Awaiting it resolves the fixture
   *  ({ data, error }), and `.order()` / `.maybeSingle()` / `.single()`
   *  terminate with the same shape so Promise.all works for paths that
   *  don't chain a terminal method. */
  function chain(table: string) {
    const fixture = () => {
      const rows =
        (table === 'catalogs' ? [opts.catalog] : opts.items ?? []).filter(
          Boolean,
        );
      return { data: rows, error: null };
    };
    const node = {
      eq(_col: unknown, _val: unknown) {
        calls.push(`eq:${table}`);
        return node;
      },
      order(_col: unknown) {
        calls.push(`order:${table}`);
        return Promise.resolve(fixture());
      },
      maybeSingle: () => {
        calls.push(`maybeSingle:${table}`);
        return Promise.resolve({
          data: fixture().data[0] ?? null,
          error: null,
        });
      },
      single: () => {
        calls.push(`single:${table}`);
        return Promise.resolve({ data: fixture().data[0] ?? null, error: null });
      },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        return Promise.resolve(fixture()).then(resolve, reject);
      },
    };
    return node;
  }

  const client = {
    calls,
    from(table: string) {
      calls.push(`from:${table}`);
      return {
        select() {
          calls.push(`select:${table}`);
          return chain(table);
        },
      };
    },
  };
  return client;
}

const accountCtx = {
  userId: 'user-1',
  accountId: 'acct-1',
  role: 'admin',
  account: { id: 'acct-1', name: 'Acme', status: 'active' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/whatsapp/catalog/items', () => {
  it('returns 401 for an unauthenticated caller', async () => {
    mocks.getCurrentAccount.mockRejectedValue(new UnauthorizedError());

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it('returns the catalog + items scoped to the caller account', async () => {
    const catalog = { id: 'cat-1', name: 'Acme Store' };
    const items = [
      { id: 'item-1', name: 'Widget', price: '1000', currency: 'USD' },
      { id: 'item-2', name: 'Gadget', price: '2500', currency: 'USD' },
    ];
    const client = makeScopedClient({ catalog, items });
    mocks.getCurrentAccount.mockResolvedValue({ ...accountCtx, supabase: client });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ catalog, items });
    expect(client.calls).toContain('eq:catalogs');
    expect(client.calls).toContain('eq:catalog_items');
  });

  it('returns catalog:null + empty items when nothing is synced', async () => {
    const client = makeScopedClient({ catalog: null, items: [] });
    mocks.getCurrentAccount.mockResolvedValue({ ...accountCtx, supabase: client });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ catalog: null, items: [] });
  });
});