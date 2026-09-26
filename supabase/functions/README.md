# Turnstile verification function

The static GitHub Pages app includes the public Turnstile site key. The Turnstile secret is read only by the `turnstile-verify` Supabase Edge Function.

## Deploy with Supabase CLI

From this repository, run:

```sh
supabase login
supabase link --project-ref zwjphdvaitugjovkmwlq
supabase secrets set TURNSTILE_SECRET_KEY
supabase functions deploy turnstile-verify --no-verify-jwt
```

When prompted by `supabase secrets set`, enter the secret value from your local `.env.local`. Do not commit that value.

The deployed function URL is:

```text
https://zwjphdvaitugjovkmwlq.supabase.co/functions/v1/turnstile-verify
```

The browser sends the public Turnstile token to this function. The function sends it to Cloudflare Siteverify using the server-side secret and returns only a success result.
