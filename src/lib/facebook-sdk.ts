// Minimal typed wrapper around the Facebook JavaScript SDK, loaded
// on demand for Meta Embedded Signup. We only use a sliver of the SDK
// (FB.login + FB.init), so this file deliberately keeps the surface
// tiny — no generic SDK typing, just the shapes this feature needs.

export interface FacebookSDK {
  init(options: {
    appId: string;
    xfbml: boolean;
    version: string;
    cookie?: boolean;
    autoLogAppEvents?: boolean;
  }): void;
  login(
    callback: (response: FbLoginResponse) => void,
    options: Record<string, unknown>,
  ): void;
}

export interface FbAuthResponse {
  /** Single-use, short-lived code — the token EXCHANGE payload this
   *  app consumes server-side. We never read `accessToken`. */
  code: string;
  userID?: string;
  expiresIn?: number;
}

export interface FbLoginResponse {
  status: 'connected' | 'not_authorized' | 'unknown';
  authResponse?: FbAuthResponse;
}

/** postMessage payload Meta posts to the opener window (target origin
 *  == our app) after the customer authorizes in the Embedded Signup
 *  popup. Opaque to the plain FB.login callback — this is how we learn
 *  WHICH phone number / WABA / business the customer granted. */
export interface MetaEmbeddedSignupEvent {
  type: 'WA_EMBEDDED_SIGNUP';
  event: 'AUTHORIZED' | string;
  phone_number_id?: string;
  waba_id?: string;
  business_id?: string;
}

const SDK_URL = 'https://connect.facebook.net/en_US/sdk.js';

/**
 * Ensure the Facebook SDK script is present and initialized, then
 * resolve with the SDK. Safe to call repeatedly — the script tag is
 * injected once (Facebook's own guard), and fbAsyncInit resolves only
 * the first waiter; subsequent calls resolve the already-inited SDK.
 */
export function loadFacebookSDK(appId: string): Promise<FacebookSDK> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Facebook SDK is browser-only'));
  }

  const ready = (): Promise<FacebookSDK> => {
    if (window.FB && typeof window.FB.login === 'function') {
      return Promise.resolve(window.FB);
    }
    return new Promise((resolve, reject) => {
      const timer = window.setInterval(() => {
        if (window.FB && typeof window.FB.login === 'function') {
          window.clearInterval(timer);
          resolve(window.FB);
        }
      }, 100);
      // The interval eventually resolves via fbAsyncInit; cap so a
      // botched load rejects instead of polling forever.
      window.setTimeout(() => {
        window.clearInterval(timer);
        reject(new Error('Facebook SDK failed to load'));
      }, 15_000);
    });
  };

  const existing = document.getElementById('facebook-jssdk');
  if (existing) return ready();

  window.fbAsyncInit = () => {
    window.FB?.init({
      appId,
      xfbml: false,
      version: 'v21.0',
    });
  };

  const script = document.createElement('script');
  script.id = 'facebook-jssdk';
  script.src = SDK_URL;
  script.async = true;
  script.defer = true;
  script.crossOrigin = 'anonymous';
  document.body.appendChild(script);
  return ready();
}

declare global {
  interface Window {
    FB?: FacebookSDK;
    fbAsyncInit?: () => void;
  }
}