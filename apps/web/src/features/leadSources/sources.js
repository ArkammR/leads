export const SOURCE_LABEL = {
  csv: "CSV / Excel", facebook: "Facebook / Instagram", google: "Google Ads", tiktok: "TikTok", website: "Website / Zapier", whatsapp: "WhatsApp",
};

// What the admin does on each platform. {url} and {key} are filled in on the page.
export const SETUP = {
  facebook: {
    blurb: "Leads from Facebook and Instagram Lead Ads (instant forms) arrive within seconds.",
    steps: [
      "Click Connect Facebook and sign in with the Facebook account that manages your Pages.",
      "Tick every Page that runs lead ads and allow all the permissions asked for.",
      "That's it. New form submissions on those Pages are imported automatically.",
    ],
  },
  google: {
    blurb: "Leads from Google Ads lead form assets (Search, YouTube, Discovery).",
    steps: [
      "In Google Ads open the campaign > Assets > Lead form > Edit.",
      "Under Lead delivery choose Webhook integration.",
      "Paste the webhook URL below and the key into the Key field, then click Send test data. A test entry appears in Recent activity.",
    ],
  },
  tiktok: {
    blurb: "Leads from TikTok Instant Form ads.",
    steps: [
      "In TikTok Ads Manager go to Tools > Leads center > CRM integration (or use Zapier: TikTok Lead Generation > Webhooks by Zapier).",
      "Choose Webhook / custom CRM and paste the webhook URL below (the key is already part of the URL).",
      "Send a test lead and check Recent activity.",
    ],
  },
  website: {
    blurb: "Your own website, landing pages, Shopify/WooCommerce forms, Zapier, Make or any tool that can send a webhook.",
    steps: [
      "Send a POST to the URL below with fields like name, phone and email (JSON or a normal form post).",
      "Any other fields (message, product, size…) are saved on the lead for the agent to see.",
      "For a plain HTML form, add a hidden field _redirect with your thank-you page address.",
    ],
  },
  whatsapp: {
    blurb: "Anyone who messages your WhatsApp business number for the first time becomes a lead.",
    steps: [
      "Twilio: Console > Messaging > WhatsApp senders > your number > Webhook URL for incoming messages: paste the URL below (method POST).",
      "WhatsApp Cloud API (Meta) instead: fill in your Phone number ID here and subscribe to messages in your Meta app's webhook settings.",
      "Existing customers who message again get a note on their lead instead of a duplicate.",
    ],
  },
};
