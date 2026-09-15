import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  UnauthorizedError,
  ForbiddenError,
} from '@/lib/auth/account'

/**
 * GET /api/whatsapp/embedded-signup/config
 *
 * Feature flag for the "Connect with Meta" card. The browser can see
 * the NEXT_PUBLIC_* vars itself, but cannot tell whether the server
 * has META_APP_ID + META_APP_SECRET (the pair required for the code
 * exchange). This route is the single source of truth: the card only
 * renders when ALL four vars are present, so a half-configured
 * instance silently falls back to the manual form instead of showing
 * a popup whose exchange would 503.
 */
export function embeddedSignupEnabled(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_META_APP_ID &&
      process.env.NEXT_PUBLIC_META_CONFIG_ID &&
      process.env.META_APP_ID &&
      process.env.META_APP_SECRET
  )
}

export async function GET() {
  try {
    await getCurrentAccount()
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
  return NextResponse.json({ enabled: embeddedSignupEnabled() })
}