import { beforeEach, describe, expect, it, vi } from 'vitest';

// GET /api/flows/import-export
//
// Guards:
//   - unauthenticated callers get 401 (via getCurrentAccount)
//   - the flag is read for the caller's OWN account, RLS-scoped
//   - a missing/unknown account resolves to `enabled: false`

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

function makeScopedClient(opts: { flag?: boolean } | null) {
  const calls: string[] = [];
  const client = {
    calls,
    from(table: string) {
      calls.push(`from:${table}`);
      return {
        select() {
          calls.push(`select:${table}`);
          return {
            eq(_col: unknown, val: unknown) {
              calls.push(`eq:${table}:${String(val)}`);
              return {
                maybeSingle: () =>
                  Promise.resolve({
                    data:
                      opts === null
                        ? null
                        : { flow_import_export_enabled: opts.flag === true },
                    error: null,
                  }),
              };
            },
          };
        },
      };
    },
  };
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/flows/import-export', () => {
  it('returns 401 for an unauthenticated caller', async () => {
    mocks.getCurrentAccount.mockRejectedValue(new UnauthorizedError());

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it('returns enabled=true when the caller account flag is on', async () => {
    const client = makeScopedClient({ flag: true });
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: client,
      userId: 'user-1',
      accountId: 'acct-1',
      role: 'admin',
      account: { id: 'acct-1', name: 'Acme', status: 'active' },
    });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true });
    expect(client.calls).toContain('eq:accounts:acct-1');
  });

  it('returns enabled=false when the caller account flag is off', async () => {
    const client = makeScopedClient({ flag: false });
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: client,
      userId: 'user-1',
      accountId: 'acct-1',
      role: 'admin',
      account: { id: 'acct-1', name: 'Acme', status: 'active' },
    });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
  });

  it('fails closed to false when no account row resolves', async () => {
    const client = makeScopedClient(null);
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: client,
      userId: 'user-1',
      accountId: 'acct-1',
      role: 'admin',
      account: { id: 'acct-1', name: 'Acme', status: 'active' },
    });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
  });
});