# Live bank sync: setup guide

Pocket Ledger can pull transactions straight from your banks with UK **Open Banking**, so you no longer download statements. You approve **read-only** access in each bank's own app (Face ID). Access lasts up to 90 days, then you reconnect with one tap. Nobody ever sees your banking password.

Two things are needed. Both are under your control:

1. **Enable Banking**: a regulated Open Banking provider. It offers a free *restricted* mode for linking **your own** accounts.
2. **Your sync server**: a small Cloudflare Worker (free plan). It holds Enable Banking's private key, which must never sit inside a web app on your phone. It stores nothing else.

> ⚠️ Check before you start:
> - GoCardless Bank Account Data, which most older guides use, stopped taking new sign-ups in 2025.
> - Enable Banking's free restricted mode is described by third-party projects as working for your own accounts. Confirm in their control panel that **your UK banks** are listed, and read their current terms.
> - The API calls follow Enable Banking's documented flow (`/aspsps`, `/auth`, `/sessions`, `/accounts/{uid}/transactions`, `/accounts/{uid}/balances`). They were tested against a simulated server, not live, so test with one bank first.

## Step 1: Enable Banking (about 10 minutes)
1. Sign up at **enablebanking.com** and open the Control Panel.
2. **Create an application.** Choose *production*, and use it for yourself only.
3. **Redirect URL:** enter `https://pocket-ledger-sync.<your-subdomain>.workers.dev/callback`. You'll know the exact address after step 2; you can come back and edit it.
4. Download the **private key** (`.pem`) and note the **application ID**.
5. Click **Activate by linking accounts** and link each bank account you want to sync (restricted mode only allows accounts linked here).

## Step 2: deploy your sync server (about 5 minutes, works on a phone)
Tap **Deploy to Cloudflare** in the app (**Accounts → Live bank sync**), or open:

`https://deploy.workers.cloudflare.com/?url=https://github.com/praisemaku7-sudo/practice/tree/main/server`

1. Sign in to, or create, a free Cloudflare account, and let it create the Worker from this repository.
2. When it asks for settings and secrets, enter:
   - `EB_APP_ID`: your Enable Banking application ID
   - `EB_PRIVATE_KEY`: the whole contents of the `.pem` file
   - `APP_TOKEN`: the password shown in the app (it generates one for you)
   - `ALLOWED_ORIGIN`: `https://praisemaku7-sudo.github.io`
3. If the deploy screen doesn't ask, add them afterwards: Workers & Pages → **pocket-ledger-sync** → Settings → **Variables and Secrets**.
4. Copy the Worker's address (`https://pocket-ledger-sync.<you>.workers.dev`). In Enable Banking, set the app's **redirect URL** to that address + `/callback`.

The server stores nothing. Your bank connections are kept in the app on your phone; the server only holds the provider key and signs requests.

Prefer a computer? Use `cd server && npx wrangler deploy`, then `npx wrangler secret put EB_APP_ID` (and the same for `EB_PRIVATE_KEY` and `APP_TOKEN`).

## Step 3: in the app
1. **Accounts → Live bank sync**: paste the Worker address and your `APP_TOKEN`, then tap **Save & test**.
2. Tap **Connect a bank**, pick your bank, approve in your bank's app, and you'll land back in Pocket Ledger.
3. For each bank account, choose which Pocket Ledger account it **fills** (or + New account), then tap **Sync now**.
4. After that, the app syncs on its own whenever you open it, at most every 6 hours.

Synced transactions go through the same duplicate-safe import as statements, so overlapping with statements you already imported is fine.

## Security notes
- The provider's private key lives only in your Cloudflare account; your bank connection ids live only on your phone.
- The app talks only to your Worker, with your `APP_TOKEN`. Requests without it are refused, and browser calls are only allowed from your app's address.
- To revoke access, use **Disconnect** in the app, revoke it in your bank's app, or delete the Worker.
