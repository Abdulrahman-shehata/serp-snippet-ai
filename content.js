(() => {
  "use strict";

  const INSTALL_FLAG = "__serpSnippetAiContentInstalled";
  const EXTRACTION_MESSAGE = "SERP_SNIPPET_AI_EXTRACT";
  const MAX_RESULTS = 10;

  if (window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;

  function cleanText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function isGoogleSearchPage() {
    const googleHost = /^(?:(?:www|encrypted)\.)?google\.(?:com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/i;
    const searchParams = new URLSearchParams(location.search);
    const searchVertical = searchParams.get("udm");
    return location.protocol === "https:"
      && googleHost.test(location.hostname)
      && location.pathname === "/search"
      && !searchParams.has("tbm")
      && (!searchVertical || searchVertical === "14")
      && Boolean(searchParams.get("q")?.trim());
  }

  function getSearchQuery() {
    return new URLSearchParams(location.search).get("q")?.trim() || "";
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    return element.getClientRects().length > 0;
  }

  function cleanResultUrl(rawHref) {
    if (!rawHref) return null;

    try {
      const url = new URL(rawHref, location.href);
      const isGoogleHost = /(^|\.)google\./i.test(url.hostname);

      if (isGoogleHost && url.pathname === "/url") {
        const destination = url.searchParams.get("q") || url.searchParams.get("url");
        if (!destination) return null;
        return cleanResultUrl(destination);
      }

      if (isGoogleHost || url.protocol !== "http:" && url.protocol !== "https:") {
        return null;
      }

      if (/googleadservices\.com$/i.test(url.hostname)) return null;

      url.hash = "";
      return url.href;
    } catch {
      return null;
    }
  }

  function urlFingerprint(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const host = url.hostname.replace(/^www\./i, "").toLowerCase();
      const path = url.pathname.replace(/\/$/, "") || "/";
      return `${host}${path}${url.search}`;
    } catch {
      return rawUrl.toLowerCase();
    }
  }

  function getResultContainer(anchor) {
    const selectors = [
      ".MjjYud",
      ".Gx5Zad",
      "div.g",
      "[data-sokoban-container]",
      "[data-sncf]"
    ];

    for (const selector of selectors) {
      const container = anchor.closest(selector);
      if (container) return container;
    }

    return anchor.parentElement?.parentElement?.parentElement || anchor.parentElement;
  }

  function isInsideExcludedFeature(anchor, container) {
    const excludedAncestorSelector = [
      "#tads",
      "#tadsb",
      "#bottomads",
      "#rhs",
      "#knowledge-panel",
      "[data-text-ad]",
      "[data-shopping-content]",
      "[data-local-pack]",
      "[data-attrid*='shopping']",
      "[data-attrid*='video']",
      ".commercial-unit-desktop-top",
      ".pla-unit",
      ".related-question-pair",
      ".VkpGBb",
      ".kp-wholepage",
      ".kp-blk",
      ".xpdopen",
      "g-scrolling-carousel",
      "g-video",
      "video-voyager"
    ].join(",");

    if (anchor.closest(excludedAncestorSelector)) return true;

    const role = container?.getAttribute("role") || "";
    const ariaLabel = cleanText(container?.getAttribute("aria-label")).toLowerCase();
    if (role === "dialog" || /^(ads|sponsored|shopping|videos?|places|local results?)\b/i.test(ariaLabel)) {
      return true;
    }

    if (container?.querySelector("[aria-expanded][data-q], .related-question-pair, g-video, [data-text-ad]")) {
      return true;
    }

    return false;
  }

  function findTitleNode(anchor) {
    const directHeading = anchor.querySelector("h3");
    if (directHeading && isVisible(directHeading)) return directHeading;

    const labelledId = anchor.getAttribute("aria-labelledby");
    if (labelledId) {
      const labelledHeading = document.getElementById(labelledId);
      if (labelledHeading?.matches("h2, h3") && isVisible(labelledHeading)) {
        return labelledHeading;
      }
    }

    return null;
  }

  function scoreSnippet(text, element, preferred) {
    if (text.length < 35 || text.length > 500) return -1;

    let score = Math.min(text.length, 220);
    if (preferred) score += 220;
    if (/[.!?](?:\s|$)/.test(text)) score += 35;
    if (element.matches("span")) score += 5;
    if (element.children.length === 0) score += 18;
    if (/^(cached|similar|translate|more results|about featured snippets)$/i.test(text)) return -1;
    return score;
  }

  function findSnippet(container, titleNode, title) {
    if (!container) return "";

    const preferredSelectors = [
      ".VwiC3b",
      "[data-sncf]",
      "[data-content-feature='1']",
      ".yXK7lf",
      ".IsZvec",
      ".aCOpRe",
      "[style*='-webkit-line-clamp']"
    ];
    const candidates = [];
    const seenText = new Set();

    function addCandidate(element, preferred = false) {
      if (!element || element === titleNode || element.contains(titleNode) || !isVisible(element)) return;
      if (element.closest("a")) return;

      let text = cleanText(element.innerText || element.textContent);
      if (!text || text === title) return;
      if (text.startsWith(title)) text = cleanText(text.slice(title.length));
      if (!text || seenText.has(text)) return;

      seenText.add(text);
      const score = scoreSnippet(text, element, preferred);
      if (score >= 0) candidates.push({ text, score });
    }

    for (const selector of preferredSelectors) {
      container.querySelectorAll(selector).forEach((element) => addCandidate(element, true));
    }

    if (!candidates.length) {
      container.querySelectorAll("div, span").forEach((element) => addCandidate(element));
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.text || "";
  }

  function getCandidateAnchors(root) {
    const anchors = [];
    const seen = new Set();

    root.querySelectorAll("a").forEach((anchor) => {
      if (!findTitleNode(anchor) || seen.has(anchor)) return;
      seen.add(anchor);
      anchors.push(anchor);
    });

    root.querySelectorAll("h3").forEach((heading) => {
      const anchor = heading.closest("a") || heading.parentElement?.closest("a");
      if (!anchor || seen.has(anchor)) return;
      seen.add(anchor);
      anchors.push(anchor);
    });

    return anchors;
  }

  function extractOrganicResults() {
    const root = document.querySelector("#search") || document.querySelector("#rso") || document.querySelector("main");
    if (!root) return [];

    const results = [];
    const seenUrls = new Set();

    for (const anchor of getCandidateAnchors(root)) {
      if (results.length >= MAX_RESULTS) break;

      const titleNode = findTitleNode(anchor);
      const title = cleanText(titleNode?.innerText || titleNode?.textContent);
      const url = cleanResultUrl(anchor.href);
      const container = getResultContainer(anchor);

      if (!title || !url || !container || isInsideExcludedFeature(anchor, container)) continue;

      const fingerprint = urlFingerprint(url);
      if (seenUrls.has(fingerprint)) continue;

      const snippet = findSnippet(container, titleNode, title);
      seenUrls.add(fingerprint);
      results.push({ title, snippet, url });
    }

    return results;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== EXTRACTION_MESSAGE) return false;

    if (!isGoogleSearchPage()) {
      sendResponse({ ok: false, error: "This tab is not a Google Search results page." });
      return false;
    }

    try {
      sendResponse({
        ok: true,
        keyword: getSearchQuery(),
        results: extractOrganicResults(),
        sourceUrl: location.href
      });
    } catch (error) {
      console.error("SERP Snippet AI could not extract results:", error);
      sendResponse({ ok: false, error: "Organic result extraction failed." });
    }

    return false;
  });
})();
