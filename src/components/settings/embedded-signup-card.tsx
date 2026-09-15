'use client';

// "Connect with Meta" — Meta Embedded Signup v4.
//
// The card is the zero-friction alternative to hand-entering a
// permanent token: the customer authorizes in a Meta popup and we
// complete the connection server-side (see
// src/app/api/whatsapp/embedded-signup/exchange/route.ts). The
// exchange code and the granted asset ids arrive through two
// independent channels that can race:
//
//   * FB.login callback   → authResponse.code (30s TTL, single-use)
//   * window postMessage  → { phone_number_id, waba_id, business_id }
//
// Both are stashed in refs and `maybeExchange` fires once BOTH are
// present, so arrival order doesn't matter. Only the code is sent to
// our API — the server never receives a token from the browser, and
// never returns one.

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MessageCircle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  loadFacebookSDK,
  type FbLoginResponse,
  type MetaEmbeddedSignupEvent,
} from '@/lib/facebook-sdk';

interface EmbeddedSignupCardProps {
  /** Result of GET /api/whatsapp/embedded-signup/config. When false
   *  the card renders nothing (operator hasn't wired it up). */
  enabled: boolean;
  canEdit: boolean;
  /** Fired after the exchange succeeds — the parent re-fetches the
   *  config row, which swaps this card for the connected state. */
  onConnected: () => void;
}

interface GrantedAssets {
  phone_number_id: string;
  waba_id: string;
  business_id: string;
}

export function EmbeddedSignupCard({
  enabled,
  canEdit,
  onConnected,
}: EmbeddedSignupCardProps) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const codeRef = useRef<string | null>(null);
  const assetsRef = useRef<GrantedAssets | null>(null);
  const inFlightRef = useRef(false);

  const maybeExchange = useCallback(async () => {
    const code = codeRef.current;
    const assets = assetsRef.current;
    if (!code || !assets || inFlightRef.current) return;
    inFlightRef.current = true;
    codeRef.current = null;
    assetsRef.current = null;

    try {
      setConnecting(true);
      setError('');
      const res = await fetch('/api/whatsapp/embedded-signup/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, ...assets }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Connection failed');
      toast.success('WhatsApp connected. Your messages will start flowing soon.');
      onConnected();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      setError(message);
      toast.error(message);
      inFlightRef.current = false;
      setConnecting(false);
    }
  }, [onConnected]);

  // Listen for Meta's postMessage announcing WHICH assets the customer
  // granted. Only the Facebook origins are trusted.
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: MessageEvent) => {
      if (!(event.origin && event.origin.startsWith('https://') && /facebook\.com$/i.test(new URL(event.origin).hostname))) {
        return;
      }
      const data = event.data as MetaEmbeddedSignupEvent | undefined;
      if (!data || data.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (data.event !== 'AUTHORIZED' || !data.phone_number_id || !data.waba_id) return;
      assetsRef.current = {
        phone_number_id: data.phone_number_id,
        waba_id: data.waba_id,
        business_id: data.business_id ?? '',
      };
      void maybeExchange();
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [enabled, maybeExchange]);

  async function handleConnect() {
    if (!enabled || !canEdit || connecting) return;
    setError('');
    const appId = process.env.NEXT_PUBLIC_META_APP_ID;
    const configId = process.env.NEXT_PUBLIC_META_CONFIG_ID;
    if (!appId || !configId) {
      setError('Meta Embedded Signup is not configured on this app. Use the manual form below.');
      return;
    }
    try {
      setConnecting(true);
      const FB = await loadFacebookSDK(appId);
      const callback = (response: FbLoginResponse) => {
        if (response.status === 'connected' && response.authResponse?.code) {
          codeRef.current = response.authResponse.code;
          void maybeExchange();
          return;
        }
        // Popup closed without authorizing (or an SDK error) — let the
        // user retry; there's nothing to exchange.
        setConnecting(false);
        setError(
          response.status === 'connected'
            ? 'Meta did not return a signup code. Please try again.'
            : 'You cancelled the Meta authorization window. Connection was not changed.',
        );
      };
      FB.login(callback, {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        // Tells Meta to run the Embedded Signup setup flow instead of
        // a plain OAuth login.
        extras: { setup: {} },
      });
    } catch (err) {
      setConnecting(false);
      setError(err instanceof Error ? err.message : 'Failed to start Meta signup');
    }
  }

  if (!enabled) return null;

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-foreground text-base">
            Connect with Meta
          </CardTitle>
          <MessageCircle className="size-5 text-primary" />
        </div>
        <CardDescription className="text-muted-foreground">
          Pick your existing WhatsApp Business number in a Meta popup —
          no permanent token or webhook setup to paste in. CONVfy takes
          care of the rest.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          onClick={handleConnect}
          disabled={!canEdit || connecting}
          className="w-full bg-[#0866FF] hover:bg-[#0866FF]/90 text-white disabled:opacity-60"
          size="lg"
        >
          {connecting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Connecting…
            </>
          ) : (
            <>
              <MessageCircle className="size-4" />
              Connect with Meta
            </>
          )}
        </Button>

        {error && (
          <Alert variant="destructive" className="py-2">
            <AlertTitle className="mb-0 text-sm">Connection failed</AlertTitle>
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}

        <p className="text-xs text-muted-foreground leading-relaxed">
          You&apos;ll be asked to pick a WhatsApp Business number and
          approve access for your Meta business. Only the number you
          choose is connected — nothing else changes in your Meta
          account. Still need the manual route?{' '}
          <a
            href="https://developers.facebook.com/docs/whatsapp/embedded-signup"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:text-primary/80"
          >
            Learn about Embedded Signup
            <ExternalLink className="size-3" />
          </a>
        </p>
      </CardContent>
    </Card>
  );
}