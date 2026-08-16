# SERP Snippet AI

Manifest V3 Chrome extension for reading up to 10 organic results from the currently open Google Search page and generating an SEO title, meta description, and relative URL path with Gemini.

Extracted results are saved in `chrome.storage.local` under `serpAnalysisCurrent` and contain:

- `keyword`
- `results` (`title`, `snippet`, and `url`)
- `sourceUrl`
- `analyzedAt`

Generated suggestions are saved separately under `serpSuggestionsCurrent`. The user's Gemini API key is stored locally under `geminiApiKey`, is never inserted into the source, and is retrieved by the extension's background worker only when a Gemini request is made.

The current model is defined once in the `GEMINI_MODEL` constant in `gemini.js`.

## Load in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this `serp-snippet-ai` folder.
5. Optionally pin **SERP Snippet AI** from Chrome's Extensions menu.

After updating the source, return to `chrome://extensions` and click the extension's **Reload** button.

## Add a Gemini API key

1. Visit [Google AI Studio](https://aistudio.google.com/apikey) and sign in.
2. Accept the Gemini API terms if prompted.
3. Open **Dashboard → API Keys**.
4. Select or create a Google Cloud project.
5. Click **Create API key** and copy the new key.
6. Open this extension, click the gear icon, paste the key, and click **Save Key**.
7. Click **Test Connection**. A valid key with access to the configured model shows a success message.

The password field is cleared after saving and the stored key is not displayed again. Use **Remove Key** to delete it or paste a replacement and click **Save Key** to replace it.

## Test extraction

1. Open a regular Google search, for example `https://www.google.com/search?q=technical+seo`.
2. Wait for the result page to finish loading.
3. Open **SERP Snippet AI** and confirm the current keyword is shown.
4. Click **Analyze SERP**.
5. Confirm the popup shows `Analyzed X organic results`, where X is no more than 10.
6. Click **Generate Suggestions** and wait for the three output cards to populate.
7. Test the individual copy buttons, **Copy All**, and **Regenerate**.
8. To inspect the stored non-secret result objects, open the popup's DevTools, go to **Application → Extension storage → Local**, and inspect `serpAnalysisCurrent` and `serpSuggestionsCurrent`.

Google changes its result markup over time. The extractor therefore finds heading links through multiple paths, checks multiple result container and snippet patterns, cleans Google redirect links, filters known SERP-feature containers, and de-duplicates destination URLs.
