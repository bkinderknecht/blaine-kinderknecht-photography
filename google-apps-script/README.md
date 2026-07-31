# Contact form → Google Sheet setup

One-time setup, about 5 minutes. This makes every contact form submission
on the website show up as a new row in a Google Sheet automatically.

## 1. Create the sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new,
   blank spreadsheet.
2. Name it something like "Pics by Peralta — Bookings."

## 2. Add the script

1. In that sheet, click **Extensions → Apps Script**.
2. Delete whatever's in the empty code editor, and paste in the entire
   contents of `contact-form-to-sheet.gs` (the file next to this one).
3. Click the save icon (or Ctrl/Cmd+S).

## 3. Deploy it as a web app

1. Click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set **Execute as: Me**.
4. Set **Who has access: Anyone**.
   (This has to be "Anyone," not "Anyone with a Google account" — the
   website itself is what's making the request, not a signed-in
   person, so it needs to be allowed through without a Google login.)
5. Click **Deploy**. Google may ask you to authorize the script —
   approve it (it's your own script running on your own sheet).
6. Copy the **Web app URL** it gives you — it looks like
   `https://script.google.com/macros/s/AKfycb.../exec`.

## 4. Tell the website about it

Open `content/settings.json` in the site folder and set:

```json
"sheetsWebhookUrl": "PASTE_YOUR_WEB_APP_URL_HERE"
```

Save the file, redeploy/refresh the site, and submit the contact form
once yourself as a test — a new row should show up in the sheet within
a few seconds. If it doesn't, double check "Who has access" is set to
"Anyone" (not "Anyone with a Google account") and that you deployed
(not just saved) after pasting the code.

## If you ever change the script later

Editing the code isn't enough by itself — you have to make a **new
deployment** (Deploy → Manage deployments → pencil icon → New version)
for the change to actually go live. Otherwise the website keeps
talking to the old version of the script.

## Notes

- This is separate from the site's Netlify Forms submission (which
  still runs too, as a backup — see Site settings → Forms in Netlify
  if you also want an email notification for each submission).
- The website can't read whether this actually succeeded or failed
  (a quirk of how Google Apps Script handles requests from other
  websites) — so the "Sent!" message on the site just means the
  request went out, not a 100% confirmation it was saved. That's why
  testing it once after setup matters.
