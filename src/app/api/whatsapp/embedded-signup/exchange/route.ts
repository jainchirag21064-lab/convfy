import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  getCurrentAccount,
  UnauthorizedError,
  ForbiddenError,
} from '@/lib/auth/account'
import {
  exchangeBusinessTokenCode,
  debugBusinessToken,
  subscribeWabaToApp,
} from '@/lib/whatsapp/meta-api'
import { encrypt } from '@/lib/whatsapp/encryption'
import { embeddedSignupEnabled } from '../config/route'

/**
 * POST /api/whatsapp/embedded-signup/exchange
 *
 * Completes a Meta Embedded Signup v4 connection. The browser sends
 * the SINGLE-USE code from FB.login(...) plus the asset ids the popup
 * granted (`phone_number_id`, `waba_id`, `business_id`). This route:
 *
 *   1. Exchanges the code for a Business Integration System User
 *      (BISU) token — SERVER ONLY; `client_secret` never ships to the
 *      browser and never returns in the response.
 *   2. Sanity-checks the fresh token via /debug_token (hard-fail so a
 *      silently-broken token can't masquerade as "connected").
 *   3. Re-claims the phone number per-account (same rule as the
 *      manual save — one WhatsApp number per account).
 *   4. Stores the token encrypted (same ciphertext format as the
 *      manual flow) with `onboarded_via = 'embedded_signup'`.
 *
 * Embedded Signup registers the chosen phone number to the app and
 * subscribes the app to the WABA automatically during the popup, so
 * this route marks `registered_at` directly and calls
 * `subscribeWabaToApp` only as idempotent belt-and-braces — no PIN
 * step exists (matching the decision for manual test numbers).
 *
 * The BISU token NEVER appears in the JSON response. On success the
 * UI refreshes via the existing GET /api/whatsapp/config to display
 * the now-connected state.
 */
export async function POST(request: Request) {
  if (!embeddedSignupEnabled()) {
    return NextResponse.json(
      { error: 'Embedded Signup is not configured on this instance.' },
      { status: 503 }
    )
  }

  let ctx: Awaited<ReturnType<typeof getCurrentAccount>>
  try {
    ctx = await getCurrentAccount()
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      )
    }
    throw err
  }
  const { supabase } = ctx

  let body: {
    code?: unknown
    phone_number_id?: unknown
    waba_id?: unknown
    business_id?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { code, phone_number_id, waba_id, business_id } = body
  if (typeof code !== 'string' || !code.trim()) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 })
  }
  if (typeof phone_number_id !== 'string' || !phone_number_id.trim()) {
    return NextResponse.json(
      { error: 'phone_number_id is required' },
      { status: 400 }
    )
  }
  if (typeof waba_id !== 'string' || !waba_id.trim()) {
    return NextResponse.json({ error: 'waba_id is required' }, { status: 400 })
  }

  const appId = process.env.META_APP_ID!
  const appSecret = process.env.META_APP_SECRET!

  // Step 1 — exchange the single-use code for the BISU token.
  let tokenResult
  try {
    tokenResult = await exchangeBusinessTokenCode({
      appId,
      appSecret,
      code: code.trim(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[embedded-signup/exchange] Code exchange failed:', message)
    return NextResponse.json(
      {
        error:
          'The signup code could not be exchanged with Meta. It is single-use and expires in ~30 seconds — please try the flow again.',
      },
      { status: 400 }
    )
  }

  // Step 2 — sanity-check the fresh token. Hard-fail: storing a token
  // Meta itself reports as invalid would surface a "Connected" state
  // that can never send or receive.
  try {
    const debug = await debugBusinessToken({
      inputToken: tokenResult.accessToken,
      appAccessToken: `${appId}|${appSecret}`,
    })
    if (!debug.isValid) {
      console.error(
        '[embedded-signup/exchange] debug_token reported invalid:',
        debug.error?.message ?? JSON.stringify(debug)
      )
      return NextResponse.json(
        { error: 'Meta reported the issued token as invalid. Please try again.' },
        { status: 502 }
      )
    }
  } catch (err) {
    // Debug is a canary, not the contract — if it flakes we still have a
    // fresh token straight from the oauth endpoint (which used the same
    // secret). Proceed but log so operators can investigate.
    console.warn('[embedded-signup/exchange] debug_token probe failed:', err)
  }

  // Step 3 — enforce one-number-per-account (same conflict rule as the
  // manual save; needs the service-role client for cross-tenant reads).
  const { data: claimed } = await adminClient()
    .from('whatsapp_config')
    .select('account_id')
    .eq('phone_number_id', phone_number_id.trim())
    .neq('account_id', ctx.accountId)
    .maybeSingle()

  if (claimed) {
    return NextResponse.json(
      {
        error:
          'This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected to one wacrm user.',
      },
      { status: 409 }
    )
  }

  // Step 4 — subscribe the WABA (idempotent; Embedded Signup already
  // subscribed it during the popup, this is belt-and-braces and also
  // surfaces a clear error if the app lacks permission).
  let subscribedAt: string | null = null
  try {
    await subscribeWabaToApp({
      wabaId: waba_id.trim(),
      accessToken: tokenResult.accessToken,
    })
    subscribedAt = new Date().toISOString()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[embedded-signup/exchange] subscribed_apps failed:', message)
  }

  // Step 5 — encrypt + persist. Existing rows keep their audit columns
  // (user_id, verify_token, mirror_inbound_media); the connection
  // fields are swapped atomically.
  const now = new Date().toISOString()
  const tokenExpiresAt =
    tokenResult.expiresIn != null
      ? new Date(Date.now() + tokenResult.expiresIn * 1000).toISOString()
      : null

  const baseRow = {
    phone_number_id: phone_number_id.trim(),
    waba_id: waba_id.trim(),
    access_token: encrypt(tokenResult.accessToken),
    status: 'connected',
    connected_at: now,
    // Embedded Signup registers the number to the app during the flow,
    // so registration is genuinely complete — no PIN step involved.
    registered_at: now,
    subscribed_apps_at: subscribedAt,
    last_registration_error: null,
    onboarded_via: 'embedded_signup',
    business_portfolio_id:
      typeof business_id === 'string' && business_id.trim()
        ? business_id.trim()
        : null,
    token_expires_at: tokenExpiresAt,
    updated_at: now,
  } as const

  const { data: existing } = await supabase
    .from('whatsapp_config')
    .select('id')
    .eq('account_id', ctx.accountId)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('whatsapp_config')
      .update(baseRow)
      .eq('account_id', ctx.accountId)
    if (error) {
      console.error('[embedded-signup/exchange] Update failed:', error)
      return NextResponse.json(
        { error: 'Failed to save configuration' },
        { status: 500 }
      )
    }
  } else {
    const { error } = await supabase
      .from('whatsapp_config')
      .insert({ account_id: ctx.accountId, user_id: ctx.userId, ...baseRow })
    if (error) {
      console.error('[embedded-signup/exchange] Insert failed:', error)
      return NextResponse.json(
        { error: 'Failed to save configuration' },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({
    success: true,
    onboarded_via: 'embedded_signup',
    registered: true,
    subscribed: subscribedAt != null,
  })
}

// Lazy-initialised service-role client — cross-tenant visibility for
// the one-number-per-account claim check, exactly like the manual
// save route. eslint-disable-next-line keeps the loose typing that
// route uses so the two stay drop-in interchangeable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function adminClient() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}