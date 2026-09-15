import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/whatsapp/catalog/sync
//
// Guards:
//   - non-admin callers get 403 before any Meta API work
//   - no whatsapp_config → 400
//   - no waba_id → 400
//   - no connected catalog → 400
//   - happy path: catalog lookup → upsert → fetch products → upsert items

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  decrypt: vi.fn(() => 'plain-token'),
  fetch: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return {
    ...actual,
    requireRole: mocks.requireRole,
  };
});
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: mocks.decrypt,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

const { POST } = await import('./route');
const { ForbiddenError } = await import('@/lib/auth/account');

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

interface ClientOpts {
  config?: Record<string, unknown> | null;
  catalogRow?: { id: string } | null;
  existingItems?: { id: string; meta_product_id: string }[];
}

/**
 * Minimal supabase query-builder mock. Each `.select()` returns a
 * chainable object: `.eq()` returns itself (so `eq().eq().maybeSingle()`
 * works), and the terminal methods resolve the configured fixture.
 */
function makeClient(opts: ClientOpts) {
  const calls: string[] = [];

  const buildSelectChain = (table: string) => {
    const fixture = (): { data: unknown[]; error: null } => {
      if (table === 'catalogs') {
        return { data: opts.catalogRow ? [opts.catalogRow] : [], error: null };
      }
      if (table === 'catalog_items') {
        return { data: opts.existingItems ?? [], error: null };
      }
      return { data: [], error: null };
    };
    const chain = {
      eq(_col: unknown, _val: unknown) {
        calls.push(`eq:${table}`);
        return chain;
      },
      order() {
        calls.push(`order:${table}`);
        return Promise.resolve(fixture());
      },
      maybeSingle: () => {
        calls.push(`maybeSingle:${table}`);
        if (table === 'catalogs') {
          return Promise.resolve({ data: opts.catalogRow ?? null, error: null });
        }
        if (table === 'whatsapp_config') {
          return Promise.resolve({ data: opts.config ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      single: () => {
        calls.push(`single:${table}`);
        if (table === 'whatsapp_config') {
          return Promise.resolve({ data: opts.config ?? null, error: null });
        }
        if (table === 'catalogs' && opts.catalogRow === null) {
          return Promise.resolve({ data: { id: 'cat-new' }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(fixture()).then(resolve, reject);
      },
    };
    return chain;
  };

  const client = {
    calls,
    from(table: string) {
      calls.push(`from:${table}`);
      return {
        select() {
          calls.push(`select:${table}`);
          const chain = buildSelectChain(table);
          return chain;
        },
        update(payload: Record<string, unknown>) {
          calls.push(`update:${table}:${JSON.stringify(payload)}`);
          return {
            eq() {
              return {
                eq() {
                  return Promise.resolve({ data: null, error: null });
                },
              };
            },
          };
        },
        insert(payload: unknown) {
          calls.push(`insert:${table}:${JSON.stringify(payload)}`);
          return {
            select() {
              return { single: () => Promise.resolve({ data: null, error: null }) };
            },
          };
        },
        delete() {
          calls.push(`delete:${table}`);
          return {
            eq() {
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };
  return client;
}

async function runWithClient(opts: ClientOpts) {
  const client = makeClient(opts);
  mocks.requireRole.mockResolvedValue({
    supabase: client,
    userId: 'user-1',
    accountId: 'acct-1',
    role: 'admin',
    account: { id: 'acct-1', name: 'Acme', status: 'active' },
  });
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/whatsapp/catalog/sync', () => {
  it('returns 403 for non-admin callers', async () => {
    mocks.requireRole.mockRejectedValue(
      new ForbiddenError('Admin access required'),
    );

    const res = await POST();

    expect(res.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns 400 when WhatsApp is not configured', async () => {
    const client = await runWithClient({ config: null });

    const res = await POST();

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/WhatsApp not configured/);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(client.calls).toContain('from:whatsapp_config');
  });

  it('returns 400 when the WABA id is missing', async () => {
    await runWithClient({ config: { waba_id: null, access_token: 'enc' } });

    const res = await POST();

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/WABA/);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns 400 when no catalog is connected to the WABA', async () => {
    await runWithClient({ config: { waba_id: 'waba-1', access_token: 'enc' } });
    mocks.fetch.mockResolvedValue(jsonResponse({ data: [] }));

    const res = await POST();

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/No product catalog is connected/);
  });

  it('syncs catalog + products on the happy path', async () => {
    const client = await runWithClient({
      config: { waba_id: 'waba-1', access_token: 'enc' },
      catalogRow: { id: 'cat-1' },
      existingItems: [
        { id: 'item-dead', meta_product_id: 'dead-product' },
        { id: 'item-live', meta_product_id: 'live-product' },
      ],
    });

    mocks.fetch
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'catalog-1', name: 'Acme Store' }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'live-product',
              name: 'Widget',
              description: 'A widget',
              price: '1000',
              currency: 'USD',
              retailer_id: 'SKU-1',
              availability: 'IN_STOCK',
              status: 'APPROVED',
              media: {
                images: [{ original_image_url: 'https://img.example/widget.jpg' }],
              },
            },
          ],
        }),
      );

    const res = await POST();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body).toMatchObject({
      catalogName: 'Acme Store',
      catalogId: 'catalog-1',
      total: 1,
      inserted: 0,
      updated: 1,
      deleted: 1,
      errors: [],
    });

    const calls = client.calls.join('\n');
    expect(calls).toContain('from:catalogs');
    expect(calls).toContain('from:catalog_items');
    // dead product vanished from Meta → deleted locally
    expect(calls).toContain('delete:catalog_items');
    // live product already existed → updated in place
    expect(calls).toContain('update:catalog_items');
    expect(calls).not.toContain('insert:catalog_items');
  });

  it('propagates Meta API failures as 502', async () => {
    await runWithClient({ config: { waba_id: 'waba-1', access_token: 'enc' } });
    mocks.fetch.mockResolvedValue(
      jsonResponse({ error: { message: 'Bad token' } }, false, 400),
    );

    const res = await POST();

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('Bad token');
  });
});