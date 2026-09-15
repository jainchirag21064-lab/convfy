import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/whatsapp/embedded-signup/exchange
//
// Completes Meta Embedded Signup v4:
//   - not enabled (missing env vars) → 503 before any auth/API work
//   - unauthenticated → 401; no account → 403
//   - missing code / phone_number_id / waba_id → 400
//   - code exchange failure → 400
//   - debug_token invalid → 502 (never store a broken token)
//   - phone number claimed by ANOTHER account → 409
//   - happy paths (existing row → update; fresh row → insert) persist
//     encrypted BISU token + onboarded_via/business_portfolio_id and
//     never echo the token back
//
// The route's admin client is a module-level singleton (lazy-cached on
// first use) and the account's supabase client comes from the mocked
// getCurrentAccount — BOTH must be the SAME client object, and that
// object's fixtures must be read from a mutable holder AT RESOLVE TIME
// (not closed over per-test) so the cached singleton never goes stale
// between tests.

interface ClientOpts {
  /** Existing whatsapp_config row for the calling account. */
  existing?: { id: string } | null;
  /** A row from ANOTHER account claiming the number. */
  claimed?: { account_id: string } | null;
}

const mocks = vi.hoisted(() => {
  const state: { current: unknown; opts: ClientOpts } = { current: null, opts: {} };
  return {
    getClient: () => state.current,
    setClient: (c: unknown) => {
      state.current = c;
    },
    getOpts: () => state.opts,
    setOpts: (o: ClientOpts) => {
      state.opts = o;
    },
    getCurrentAccount: vi.fn(),
    exchangeBusinessTokenCode: vi.fn(),
    debugBusinessToken: vi.fn(),
    subscribeWabaToApp: vi.fn(),
    encrypt: vi.fn((plain: string) => `enc:${plain}`),
  };
});

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, getCurrentAccount: mocks.getCurrentAccount };
});
vi.mock('@/lib/whatsapp/meta-api', () => ({
  exchangeBusinessTokenCode: mocks.exchangeBusinessTokenCode,
  debugBusinessToken: mocks.debugBusinessToken,
  subscribeWabaToApp: mocks.subscribeWabaToApp,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt: mocks.encrypt }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mocks.getClient() }));

const { POST } = await import('./route');

type SupabaseChain = {
  eq: (k: string, v: unknown) => SupabaseChain;
  neq: (k: string, v: unknown) => SupabaseChain;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
};

/** Build the single shared client. Fixtures are read from the holder at
 *  call time, so the route's cached admin client stays in sync with the
 *  currently-running test. */
function makeSharedClient() {
  const calls: string[] = [];
  const fixture = (isClaimCheck: boolean) => {
    const opts = mocks.getOpts();
    const row = isClaimCheck ? opts.claimed : opts.existing;
    return { data: row ?? null, error: null };
  };

  const buildSelectChain = (): SupabaseChain => {
    let isClaimCheck = false;
    const chain: SupabaseChain = {
      eq(k: string, v: unknown) {
        calls.push(`eq:${k}:${String(v)}`);
        return chain;
      },
      neq(k: string, v: unknown) {
        calls.push(`neq:${k}:${String(v)}`);
        isClaimCheck = true;
        return chain;
      },
      maybeSingle: () => {
        calls.push(isClaimCheck ? 'maybeSingle:claim' : 'maybeSingle:existing');
        return Promise.resolve(fixture(isClaimCheck));
      },
      then(resolve, reject) {
        return Promise.resolve(fixture(isClaimCheck)).then(resolve, reject);
      },
    };
    return chain;
  };

  const client = {
    calls,
    from(table: string) {
      calls.push(`from:${table}`);
      if (table !== 'whatsapp_config') throw new Error(`unexpected table ${table}`);
      return {
        select(_cols: string) {
          calls.push('select');
          return buildSelectChain();
        },
        update(payload: Record<string, unknown>) {
          calls.push(`update:${JSON.stringify(payload)}`);
          return {
            eq() {
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
        insert(payload: Record<string, unknown>) {
          calls.push(`insert:${JSON.stringify(payload)}`);
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  return client;
}

const sharedClient = makeSharedClient();
mocks.setClient(sharedClient);

function runWithClient(opts: ClientOpts) {
  mocks.setOpts(opts);
  mocks.getCurrentAccount.mockResolvedValue({
    supabase: sharedClient,
    userId: 'user-1',
    accountId: 'acct-1',
  });
}

function post(body: unknown) {
  return POST(new Request('http://localhost/api/whatsapp/embedded-signup/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

const validBody = {
  code: 'single-use-code',
  phone_number_id: '1234567890',
  waba_id: 'waba-1',
  business_id: 'biz-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  sharedClient.calls.length = 0;
  mocks.setOpts({});
  vi.stubEnv('NEXT_PUBLIC_META_APP_ID', 'pub-app-id');
  vi.stubEnv('NEXT_PUBLIC_META_CONFIG_ID', 'cfg-id');
  vi.stubEnv('META_APP_ID', 'app-id');
  vi.stubEnv('META_APP_SECRET', 'app-secret');
  mocks.exchangeBusinessTokenCode.mockResolvedValue({
    accessToken: 'EAABISU',
    tokenType: 'bearer',
    expiresIn: 86400,
  });
  mocks.debugBusinessToken.mockResolvedValue({
    appId: 'app-id',
    type: 'BUSINESS',
    isValid: true,
    expiresAtMs: null,
    dataAccessExpiresAtMs: null,
    scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
    granularScopes: [],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/whatsapp/embedded-signup/exchange', () => {
  it('returns 503 when Embedded Signup is not configured', async () => {
    vi.stubEnv('META_APP_ID', '');
    runWithClient({ existing: null });

    const res = await post(validBody);

    expect(res.status).toBe(503);
    expect(mocks.exchangeBusinessTokenCode).not.toHaveBeenCalled();
    expect(sharedClient.calls).toHaveLength(0);
  });

  it('returns 401 when unauthenticated', async () => {
    const { UnauthorizedError } = await import('@/lib/auth/account');
    mocks.getCurrentAccount.mockRejectedValue(new UnauthorizedError('no session'));

    const res = await post(validBody);

    expect(res.status).toBe(401);
    expect(mocks.exchangeBusinessTokenCode).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller has no account', async () => {
    const { ForbiddenError } = await import('@/lib/auth/account');
    mocks.getCurrentAccount.mockRejectedValue(new ForbiddenError('no account'));

    const res = await post(validBody);

    expect(res.status).toBe(403);
    expect(mocks.exchangeBusinessTokenCode).not.toHaveBeenCalled();
  });

  it('returns 400 when required fields are missing', async () => {
    runWithClient({ existing: null });

    const res = await post({ code: '', phone_number_id: 'x' });

    expect(res.status).toBe(400);
    expect(mocks.exchangeBusinessTokenCode).not.toHaveBeenCalled();
  });

  it('returns 400 when the code exchange fails', async () => {
    runWithClient({ existing: null });
    mocks.exchangeBusinessTokenCode.mockRejectedValue(
      new Error('Invalid code or code expired'),
    );

    const res = await post(validBody);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/single-use/);
    expect(mocks.debugBusinessToken).not.toHaveBeenCalled();
  });

  it('returns 502 when debug_token reports the token invalid', async () => {
    runWithClient({ existing: null });
    mocks.debugBusinessToken.mockResolvedValue({
      appId: 'app-id',
      type: 'BUSINESS',
      isValid: false,
      expiresAtMs: null,
      dataAccessExpiresAtMs: null,
      scopes: [],
      granularScopes: [],
      error: { message: 'Error validating access token', code: 190 },
    });

    const res = await post(validBody);

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/invalid/);
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });

  it('returns 409 when the number is claimed by another account', async () => {
    runWithClient({ existing: null, claimed: { account_id: 'acct-other' } });

    const res = await post(validBody);

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already linked to another account/);
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });

  it('updates the existing row on the happy path and never echoes the token', async () => {
    runWithClient({ existing: { id: 'cfg-1' } });

    const res = await post(validBody);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      onboarded_via: 'embedded_signup',
      registered: true,
      subscribed: true,
    });
    expect(JSON.stringify(body)).not.toContain('EAABISU');

    expect(mocks.exchangeBusinessTokenCode).toHaveBeenCalledWith({
      appId: 'app-id',
      appSecret: 'app-secret',
      code: 'single-use-code',
    });
    expect(mocks.debugBusinessToken).toHaveBeenCalledWith({
      inputToken: 'EAABISU',
      appAccessToken: 'app-id|app-secret',
    });
    expect(mocks.subscribeWabaToApp).toHaveBeenCalledWith({
      wabaId: 'waba-1',
      accessToken: 'EAABISU',
    });

    const calls = sharedClient.calls.join('\n');
    expect(calls).toContain('update:');
    expect(calls).not.toContain('insert:');
    const updateCall = sharedClient.calls.find((c) => c.startsWith('update:'));
    const payload = JSON.parse(updateCall!.slice('update:'.length));
    expect(payload).toMatchObject({
      phone_number_id: '1234567890',
      waba_id: 'waba-1',
      access_token: 'enc:EAABISU',
      status: 'connected',
      onboarded_via: 'embedded_signup',
      business_portfolio_id: 'biz-1',
      registered_at: expect.any(String),
    });
  });

  it('inserts a fresh row when no config exists yet', async () => {
    runWithClient({ existing: null });

    const res = await post(validBody);

    expect(res.status).toBe(200);
    const calls = sharedClient.calls.join('\n');
    expect(calls).toContain('insert:');
    const insertCall = sharedClient.calls.find((c) => c.startsWith('insert:'));
    const payload = JSON.parse(insertCall!.slice('insert:'.length));
    expect(payload).toMatchObject({
      account_id: 'acct-1',
      user_id: 'user-1',
      onboarded_via: 'embedded_signup',
      access_token: 'enc:EAABISU',
    });
    expect((await res.json()).subscribed).toBe(true);
  });

  it('persists a null token_expires_at when Meta returns no expiry', async () => {
    mocks.exchangeBusinessTokenCode.mockResolvedValue({
      accessToken: 'EAABISU',
      tokenType: 'bearer',
      expiresIn: null,
    });
    runWithClient({ existing: null });

    const res = await post(validBody);

    expect(res.status).toBe(200);
    const insertCall = sharedClient.calls.find((c) => c.startsWith('insert:'));
    const payload = JSON.parse(insertCall!.slice('insert:'.length));
    expect(payload.token_expires_at).toBeNull();
  });
});