# 02 - Dynamic Sender Domain Link Engine

## Overview

A central requirement for multi-domain journal outreach is ensuring that **every outgoing email carries links matching the sender's verified domain**, rather than hardcoded URLs. If `editor@publication.onlypaperpublication.com` sends an email, all upload and opt-out links must route through that sender's domain.

All **232 template combinations** seeded in the extension use dynamic sender placeholders:
```
https://{{senderDomain}}/<journal-upload-path>
https://{{senderDomain}}/<journal-optout-path>
```

---

## Detection & Resolution Pipeline

When an operator selects a combination in Gmail or when an automated campaign dispatches:

```
+-------------------------------------------------------------------------------+
| Compose Window Opened / Combination Selected                                 |
+-------------------------------------------------------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------------------+
| Step 1: detectActiveSenderEmail(composeDialog)                                |
|   1. Scans Compose window "From:" input (input[name="from"])                  |
|   2. Scans Compose "From:" container (.az9, [aria-label^="From"])             |
|   3. Scans Google Account Avatar in top bar (#gb a[aria-label*="@"])         |
|   4. Scans Document Title ("Inbox - editor@... - Gmail")                      |
|   5. Scans URL authuser parameters (?authuser=editor@...)                     |
+-------------------------------------------------------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------------------+
| Step 2: Extract & Normalize Domain                                            |
|   senderEmail.split('@')[1].trim().toLowerCase()                              |
+-------------------------------------------------------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------------------+
| Step 3: getEffectiveSenderDomain(senderEmail, rawDomain)                      |
|   If rawDomain is generic webmail (gmail.com, yahoo.com, outlook.com, etc.):  |
|     -> Falls back to 'worldwidejournals.co.in'                                |
|   Otherwise:                                                                  |
|     -> Returns actual sending domain (e.g. publication.onlypaperpublication.com)|
+-------------------------------------------------------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------------------+
| Step 4: resolveDynamicTemplate(rawContent, composeDialog)                     |
|   1. Replaces {{senderDomain}} and {{sender_domain}}                          |
|   2. Replaces {{senderEmail}} and {{sender_email}}                            |
|   3. Auto-converts relative links: href="/path" -> href="https://${domain}/"  |
|   4. Preserves native merge tags ([FNAME], @name)                             |
+-------------------------------------------------------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------------------+
| Injected into Compose Window Body & Subject with Unsubscribe Anchor Preserved |
+-------------------------------------------------------------------------------+
```

---

## Code Implementation Reference

In [content.js](file:///D:/projects/extension/src/content/content.js):

```javascript
function resolveDynamicTemplate(rawContent, composeDialog) {
  if (!rawContent || typeof rawContent !== 'string') return rawContent;

  const { senderEmail, senderDomain: rawDomain } = getSenderEmailAndDomain(composeDialog);
  const senderDomain = getEffectiveSenderDomain(senderEmail, rawDomain);
  let resolved = rawContent;

  // 1. Replace domain placeholders
  resolved = resolved
    .replace(/\{\{\s*senderDomain\s*\}\}/gi, senderDomain)
    .replace(/\{\s*senderDomain\s*\}/gi, senderDomain)
    .replace(/\{\{\s*sender_domain\s*\}\}/gi, senderDomain)
    .replace(/\{\s*sender_domain\s*\}/gi, senderDomain);

  // 2. Replace email placeholders
  if (senderEmail) {
    resolved = resolved
      .replace(/\{\{\s*senderEmail\s*\}\}/gi, senderEmail)
      .replace(/\{\s*senderEmail\s*\}/gi, senderEmail)
      .replace(/\{\{\s*sender_email\s*\}\}/gi, senderEmail)
      .replace(/\{\s*sender_email\s*\}/gi, senderEmail);
  }

  // 3. Auto-convert relative links
  resolved = resolved.replace(/href=(["'])\/([^"'>\s]+)(["'])/gi, (match, p1, p2, p3) => {
    return `href=${p1}https://${senderDomain}/${p2}${p3}`;
  });

  return resolved;
}
```

---

## Production Domains Covered

The engine seamlessly detects and injects any of the verified sending subdomains:
- `publication.onlypaperpublication.com`
- `education.yourpaperpublication.com`
- `education.yourseducationmatter.com`
- `education.researchpaperpublication.com`
- `worldwidejournals.co.in` (Default Portal Fallback)
