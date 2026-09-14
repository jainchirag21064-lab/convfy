import { beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/platform/accounts/[id]/flows-import-export
//
// Guards:
//   - non-platform-admin callers get 403 before any DB work
//   - `enabled` must be a boolean (anything else is 400)
//   - malformed JSON is 400
//   - a missing account is 404
//   - a valid flag persists as accounts.flow_import_export_enabled

const mocks = vi.hoisted(() => ({
  requirePlatformAdmin: vi.fn(),
  platformAdminClient: vi.fn(),
}));

vi.mock('@/lib/auth/platform-admin', () => ({
  requirePlatformAdmin: mocks.requirePlatformAdmin,
}));
vi.mock('@/lib/supabase/platform-admin-client', () => ({
  platformAdminClient: mocks.platformAdminClient,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

const { POST } = await import('./route');
const { ForbiddenError } = await import('@/lib/auth/account');

function makeAdminClient(opts: {
  targetAccount?: { id: string } | null;
  updateError?: unknown;
}) {
  const calls: string[] = [];
  const client = {
    calls,
    from(table: string) {
      calls.push(`from:${table}`);
      const row = opts.targetAccount ?? null;
      return {
        select() {
          calls.push(`select:${table}`);
          return {
            eq() {
              calls.push(`eq:${table}:first`);
              return {
                maybeSingle: () => Promise.resolve({ data: row, error: null }),
              };
            },
          };
        },
        update(payload: Record<string, unknown>) {
          calls.push(`update:${table}:${JSON.stringify(payload)}`);
          return {
            eq() {
              calls.push(`eqUpdate:${table}`);
              return Promise.resolve({
                data: null,
                error: opts.updateError ?? null,
              });
            },
          };
        },
      };
    },
  };
  return client;
}

const post = (body: unknown, id = 'acct-1') =>
  POST(
    new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    {
      params: Promise.resolve({ id }),
    }
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePlatformAdmin.mockResolvedValue({ userId: 'admin-1' });
});

describe('POST /api/platform/accounts/[id]/flows-import-export', () => {
  it('returns 403 for non-platform-admin callers before any DB work', async () => {
    mocks.requirePlatformAdmin.mockRejectedValue(
      new ForbiddenError('Platform admin access required')
    );

    const res = await post({ enabled: true });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Platform admin access required');
    expect(mocks.platformAdminClient).not.toHaveBeenCalled();
  });

  it('enables the flag for an account', async () => {
    const client = makeAdminClient({ targetAccount: { id: 'acct-1' } });
    mocks.platformAdminClient.mockReturnValue(client);

    const res = await post({ enabled: true });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: 'acct-1',
      flow_import_export_enabled: true,
    });
    expect(client.calls).toContain('update:accounts:{"flow_import_export_enabled":true}');
  });

  it('disables the flag for an account', async () => {
    const client = makeAdminClient({ targetAccount: { id: 'acct-1' } });
    mocks.platformAdminClient.mockReturnValue(client);

    const res = await post({ enabled: false });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: 'acct-1',
      flow_import_export_enabled: false,
    });
    expect(client.calls).toContain('update:accounts:{"flow_import_export_enabled":false}');
  });

  it('rejects a non-boolean enabled with 400 and no UPDATE', async () => {
    const client = makeAdminClient({ targetAccount: { id: 'acct-1' } });
    mocks.platformAdminClient.mockReturnValue(client);

    for (const enabled of [1, 'yes', null]) {
      const res = await post({ enabled });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/boolean/);
    }

    expect(client.calls.some((c) => c.startsWith('update:'))).toBe(false);
  });

  it('rejects malformed JSON with 400', async () => {
    mocks.platformAdminClient.mockReturnValue(
      makeAdminClient({ targetAccount: { id: 'acct-1' } })
    );

    const res = await POST(
      new Request('http://localhost/', { method: 'POST', body: '{nope' }),
      { params: Promise.resolve({ id: 'acct-1' }) }
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid JSON body');
  });

  it('returns 404 for an unknown account', async () => {
    const client = makeAdminClient({ targetAccount: null });
    mocks.platformAdminClient.mockReturnValue(client);

    const res = await post({ enabled: true });

    expect(res.status).toBe(404);
    expect(client.calls.some((c) => c.startsWith('update:'))).toBe(false);
  });
});