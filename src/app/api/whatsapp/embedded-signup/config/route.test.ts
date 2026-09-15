import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// GET /api/whatsapp/embedded-signup/config
//
// Feature flag for the "Connect with Meta" card:
//   - enabled=true only when ALL four env vars are present (both
//     NEXT_PUBLIC_* the browser can verify and the server-side pair)
//   - 401 / 403 for unauthenticated / account-less callers

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, getCurrentAccount: mocks.getCurrentAccount };
});

const { GET, embeddedSignupEnabled } = await import('./route');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_META_APP_ID', 'pub-app-id');
  vi.stubEnv('NEXT_PUBLIC_META_CONFIG_ID', 'cfg-id');
  vi.stubEnv('META_APP_ID', 'app-id');
  vi.stubEnv('META_APP_SECRET', 'sec');
  mocks.getCurrentAccount.mockResolvedValue({
    supabase: {},
    userId: 'user-1',
    accountId: 'acct-1',
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/whatsapp/embedded-signup/config', () => {
  it('returns enabled=true when all four env vars are present', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ enabled: true });
    expect(embeddedSignupEnabled()).toBe(true);
  });

  it('returns enabled=false when a server-side var is missing', async () => {
    vi.stubEnv('META_APP_SECRET', '');
    const res = await GET();
    await expect(res.json()).resolves.toEqual({ enabled: false });
    expect(embeddedSignupEnabled()).toBe(false);
  });

  it('returns enabled=false when a public var is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_CONFIG_ID', '');
    const res = await GET();
    await expect(res.json()).resolves.toEqual({ enabled: false });
  });

  it('returns 401 when unauthenticated', async () => {
    const { UnauthorizedError } = await import('@/lib/auth/account');
    mocks.getCurrentAccount.mockRejectedValue(new UnauthorizedError('no session'));
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns 403 when the caller has no account', async () => {
    const { ForbiddenError } = await import('@/lib/auth/account');
    mocks.getCurrentAccount.mockRejectedValue(new ForbiddenError('no account'));
    const res = await GET();
    expect(res.status).toBe(403);
  });
});