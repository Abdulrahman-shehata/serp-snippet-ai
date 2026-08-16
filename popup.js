"use strict";

const ANALYSIS_STORAGE_KEY = "serpAnalysisCurrent";
const SUGGESTIONS_STORAGE_KEY = "serpSuggestionsCurrent";
const API_KEY_STORAGE_KEY = "geminiApiKey";
const API_KEY_CONFIGURED_KEY = "geminiApiKeyConfigured";
const THEME_STORAGE_KEY = "serpSnippetTheme";
const EXTRACTION_MESSAGE = "SERP_SNIPPET_AI_EXTRACT";
const GEMINI_TEST_MESSAGE = "SERP_SNIPPET_AI_TEST_GEMINI";
const GEMINI_GENERATE_MESSAGE = "SERP_SNIPPET_AI_GENERATE";
const PLACEHOLDER_TEXT = "Waiting for AI generation...";

const elements = {
  mainView: document.querySelector("#mainView"),
  settingsView: document.querySelector("#settingsView"),
  settingsButton: document.querySelector("#settingsButton"),
  themeButton: document.querySelector("#themeButton"),
  backButton: document.querySelector("#backButton"),
  keywordValue: document.querySelector("#keywordValue"),
  resultCount: document.querySelector("#resultCount"),
  analyzeButton: document.querySelector("#analyzeButton"),
  analyzeButtonLabel: document.querySelector("#analyzeButton span"),
  statusMessage: document.querySelector("#statusMessage"),
  titleOutput: document.querySelector("#titleOutput"),
  descriptionOutput: document.querySelector("#descriptionOutput"),
  urlOutput: document.querySelector("#urlOutput"),
  generateButton: document.querySelector("#generateButton"),
  regenerateButton: document.querySelector("#regenerateButton"),
  copyTitleButton: document.querySelector("#copyTitleButton"),
  copyDescriptionButton: document.querySelector("#copyDescriptionButton"),
  copyUrlButton: document.querySelector("#copyUrlButton"),
  copyAllButton: document.querySelector("#copyAllButton"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  keyState: document.querySelector("#keyState"),
  saveKeyButton: document.querySelector("#saveKeyButton"),
  testConnectionButton: document.querySelector("#testConnectionButton"),
  removeKeyButton: document.querySelector("#removeKeyButton"),
  settingsStatus: document.querySelector("#settingsStatus")
};

let activeTab = null;
let storedAnalysis = null;
let currentSuggestions = null;
let hasConfiguredApiKey = false;
let generationInProgress = false;
let currentTheme = "light";

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  currentTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = currentTheme;
  const targetTheme = currentTheme === "dark" ? "light" : "dark";
  const label = `Switch to ${targetTheme} theme`;
  elements.themeButton.setAttribute("aria-label", label);
  elements.themeButton.title = label;
}

async function restoreTheme() {
  try {
    const stored = await chrome.storage.local.get(THEME_STORAGE_KEY);
    const savedTheme = stored[THEME_STORAGE_KEY];
    applyTheme(savedTheme === "dark" || savedTheme === "light" ? savedTheme : getSystemTheme());
  } catch {
    applyTheme(getSystemTheme());
  }
}

async function toggleTheme() {
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  try {
    await chrome.storage.local.set({ [THEME_STORAGE_KEY]: nextTheme });
  } catch {
    // The visible theme still changes if Chrome cannot persist the preference.
  }
}

function isGoogleSearchUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const googleHost = /^(?:(?:www|encrypted)\.)?google\.(?:com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/i;
    const searchVertical = url.searchParams.get("udm");
    return url.protocol === "https:"
      && googleHost.test(url.hostname)
      && url.pathname === "/search"
      && !url.searchParams.has("tbm")
      && (!searchVertical || searchVertical === "14")
      && Boolean(url.searchParams.get("q")?.trim());
  } catch {
    return false;
  }
}

function getKeyword(rawUrl) {
  try {
    return new URL(rawUrl).searchParams.get("q")?.trim() || "";
  } catch {
    return "";
  }
}

function normalizeSerpUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const relevantParams = new URLSearchParams();
    for (const name of ["q", "start", "udm", "filter"]) {
      const value = url.searchParams.get(name);
      if (value) relevantParams.set(name, value);
    }
    return `${url.origin}${url.pathname}?${relevantParams.toString()}`;
  } catch {
    return rawUrl;
  }
}

function setMessage(element, message = "", tone = "") {
  element.textContent = message;
  element.className = element === elements.settingsStatus
    ? "status-message settings-status"
    : "status-message";
  if (tone) element.classList.add(`is-${tone}`);
}

function setMainStatus(message = "", tone = "") {
  setMessage(elements.statusMessage, message, tone);
}

function setSettingsStatus(message = "", tone = "") {
  setMessage(elements.settingsStatus, message, tone);
}

function renderCount(count) {
  elements.resultCount.textContent = `Analyzed ${count} organic results`;
}

function setAnalyzeLoading(isLoading) {
  elements.analyzeButton.disabled = isLoading;
  elements.analyzeButton.classList.toggle("is-loading", isLoading);
  elements.analyzeButtonLabel.textContent = isLoading ? "Analyzing…" : "Analyze SERP";
}

function updateKeyState() {
  elements.keyState.textContent = hasConfiguredApiKey ? "API key saved" : "No API key saved";
  elements.keyState.classList.toggle("has-key", hasConfiguredApiKey);
  elements.removeKeyButton.disabled = !hasConfiguredApiKey;
  elements.testConnectionButton.disabled = !hasConfiguredApiKey;
}

function updateSuggestionControls() {
  const hasSuggestions = Boolean(currentSuggestions);
  elements.regenerateButton.disabled = generationInProgress
    || !hasSuggestions
    || !hasConfiguredApiKey
    || !storedAnalysis?.results?.length;
  elements.copyTitleButton.disabled = !hasSuggestions;
  elements.copyDescriptionButton.disabled = !hasSuggestions;
  elements.copyUrlButton.disabled = !hasSuggestions;
  elements.copyAllButton.disabled = !hasSuggestions;
}

function setGenerationLoading(isLoading) {
  generationInProgress = isLoading;
  elements.generateButton.disabled = isLoading;
  elements.generateButton.textContent = isLoading ? "Generating..." : "Generate Suggestions";
  updateSuggestionControls();
}

function renderSuggestions(suggestions) {
  currentSuggestions = suggestions;
  const values = suggestions || {
    title: PLACEHOLDER_TEXT,
    description: PLACEHOLDER_TEXT,
    url: PLACEHOLDER_TEXT
  };

  for (const [name, element] of [
    ["title", elements.titleOutput],
    ["description", elements.descriptionOutput],
    ["url", elements.urlOutput]
  ]) {
    element.textContent = values[name];
    element.classList.toggle("is-placeholder", !suggestions);
  }

  updateSuggestionControls();
}

function openSettings(message = "", tone = "") {
  elements.mainView.hidden = true;
  elements.settingsView.hidden = false;
  elements.settingsButton.hidden = true;
  elements.apiKeyInput.value = "";
  updateKeyState();
  setSettingsStatus(message, tone);
  elements.apiKeyInput.focus();
}

function closeSettings() {
  elements.settingsView.hidden = true;
  elements.mainView.hidden = false;
  elements.settingsButton.hidden = false;
  elements.apiKeyInput.value = "";
  setSettingsStatus();
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function analysisBelongsToTab(analysis, tab) {
  return analysis
    && tab?.url
    && normalizeSerpUrl(analysis.sourceUrl) === normalizeSerpUrl(tab.url);
}

function suggestionsBelongToAnalysis(suggestions, analysis) {
  return suggestions
    && analysis
    && suggestions.sourceUrl === analysis.sourceUrl
    && suggestions.analysisTimestamp === analysis.analyzedAt;
}

async function restoreLocalState(tab) {
  const stored = await chrome.storage.local.get([
    ANALYSIS_STORAGE_KEY,
    SUGGESTIONS_STORAGE_KEY,
    API_KEY_CONFIGURED_KEY
  ]);

  hasConfiguredApiKey = stored[API_KEY_CONFIGURED_KEY] === true;
  storedAnalysis = analysisBelongsToTab(stored[ANALYSIS_STORAGE_KEY], tab)
    ? stored[ANALYSIS_STORAGE_KEY]
    : null;
  const savedSuggestions = suggestionsBelongToAnalysis(stored[SUGGESTIONS_STORAGE_KEY], storedAnalysis)
    ? stored[SUGGESTIONS_STORAGE_KEY]
    : null;

  renderCount(storedAnalysis?.results?.length || 0);
  renderSuggestions(savedSuggestions ? {
    title: savedSuggestions.title,
    description: savedSuggestions.description,
    url: savedSuggestions.url
  } : null);
  updateKeyState();
}

async function sendExtractionRequest(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: EXTRACTION_MESSAGE });
  } catch (firstError) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    return chrome.tabs.sendMessage(tabId, { type: EXTRACTION_MESSAGE });
  }
}

async function initialize() {
  await restoreTheme();
  try {
    activeTab = await getActiveTab();
    await restoreLocalState(activeTab);

    if (!activeTab?.url || !isGoogleSearchUrl(activeTab.url)) {
      elements.keywordValue.textContent = "No Google search detected";
      elements.keywordValue.title = "";
      elements.analyzeButton.disabled = true;
      renderCount(0);
      setMainStatus("Open a Google results page to analyze its organic listings.");
      return;
    }

    const keyword = getKeyword(activeTab.url);
    elements.keywordValue.textContent = keyword;
    elements.keywordValue.title = keyword;
  } catch (error) {
    elements.keywordValue.textContent = "Unable to read this tab";
    elements.analyzeButton.disabled = true;
    setMainStatus("Chrome could not access the active tab.", "error");
  }
}

async function analyzeSerp() {
  if (!activeTab?.id || !isGoogleSearchUrl(activeTab.url)) return;

  setAnalyzeLoading(true);
  setMainStatus("Reading visible organic search results…");

  try {
    const response = await sendExtractionRequest(activeTab.id);
    if (!response?.ok || !Array.isArray(response.results)) {
      throw new Error("The page did not return SERP data.");
    }

    storedAnalysis = {
      keyword: response.keyword,
      results: response.results,
      sourceUrl: response.sourceUrl,
      analyzedAt: new Date().toISOString()
    };

    await chrome.storage.local.set({ [ANALYSIS_STORAGE_KEY]: storedAnalysis });
    await chrome.storage.local.remove(SUGGESTIONS_STORAGE_KEY);
    renderSuggestions(null);
    elements.keywordValue.textContent = storedAnalysis.keyword;
    elements.keywordValue.title = storedAnalysis.keyword;
    renderCount(storedAnalysis.results.length);
    setMainStatus(
      storedAnalysis.results.length
        ? "Organic results saved locally and ready for AI generation."
        : "No eligible organic results were found on this page.",
      storedAnalysis.results.length ? "success" : "error"
    );
  } catch (error) {
    setMainStatus("Could not analyze this page. Refresh the Google results and try again.", "error");
  } finally {
    setAnalyzeLoading(false);
  }
}

async function saveApiKey() {
  const apiKey = elements.apiKeyInput.value.trim();
  if (!apiKey) {
    setSettingsStatus("Enter a Gemini API key before saving.", "error");
    return;
  }

  elements.saveKeyButton.disabled = true;
  try {
    await chrome.storage.local.set({
      [API_KEY_STORAGE_KEY]: apiKey,
      [API_KEY_CONFIGURED_KEY]: true
    });
    elements.apiKeyInput.value = "";
    hasConfiguredApiKey = true;
    updateKeyState();
    updateSuggestionControls();
    setSettingsStatus("API key saved locally.", "success");
  } catch (error) {
    setSettingsStatus("Chrome could not save the API key. Please retry.", "error");
  } finally {
    elements.saveKeyButton.disabled = false;
  }
}

async function testConnection() {
  elements.testConnectionButton.disabled = true;
  elements.testConnectionButton.textContent = "Testing...";
  setSettingsStatus("Testing Gemini connection…");

  try {
    const response = await chrome.runtime.sendMessage({ type: GEMINI_TEST_MESSAGE });
    if (!response?.ok && response?.code === "MISSING_API_KEY") {
      hasConfiguredApiKey = false;
      await chrome.storage.local.set({ [API_KEY_CONFIGURED_KEY]: false });
      updateKeyState();
      setSettingsStatus("No saved API key was found.", "error");
      return;
    }
    if (!response?.ok) throw new Error(response?.error || "Gemini could not test the connection.");
    setSettingsStatus("Connection successful. Gemini is ready.", "success");
  } catch (error) {
    setSettingsStatus(error?.message || "Gemini could not test the connection.", "error");
  } finally {
    elements.testConnectionButton.textContent = "Test Connection";
    elements.testConnectionButton.disabled = !hasConfiguredApiKey;
  }
}

async function removeApiKey() {
  elements.removeKeyButton.disabled = true;
  try {
    await chrome.storage.local.remove([API_KEY_STORAGE_KEY, API_KEY_CONFIGURED_KEY]);
    elements.apiKeyInput.value = "";
    hasConfiguredApiKey = false;
    updateKeyState();
    updateSuggestionControls();
    setSettingsStatus("API key removed from local storage.", "success");
  } catch (error) {
    setSettingsStatus("Chrome could not remove the API key. Please retry.", "error");
  }
}

async function generateSuggestions(isRegeneration = false) {
  if (generationInProgress) return;

  if (!hasConfiguredApiKey) {
    openSettings("Save a Gemini API key before generating suggestions.", "error");
    return;
  }

  if (!storedAnalysis?.results?.length) {
    setMainStatus("Analyze a Google SERP before generating suggestions.", "error");
    return;
  }

  setGenerationLoading(true);
  setMainStatus("Gemini is analyzing the organic results…");

  try {
    const response = await chrome.runtime.sendMessage({
      type: GEMINI_GENERATE_MESSAGE,
      analysis: storedAnalysis,
      previousSuggestions: isRegeneration ? currentSuggestions : null
    });

    if (!response?.ok && response?.code === "MISSING_API_KEY") {
      hasConfiguredApiKey = false;
      await chrome.storage.local.set({ [API_KEY_CONFIGURED_KEY]: false });
      updateKeyState();
      throw new Error(response.error);
    }
    if (!response?.ok || !response.suggestions) {
      throw new Error(response?.error || "Gemini could not complete the request. Please retry.");
    }

    const suggestions = response.suggestions;

    renderSuggestions(suggestions);
    await chrome.storage.local.set({
      [SUGGESTIONS_STORAGE_KEY]: {
        ...suggestions,
        sourceUrl: storedAnalysis.sourceUrl,
        analysisTimestamp: storedAnalysis.analyzedAt,
        generatedAt: new Date().toISOString()
      }
    });
    setMainStatus("Suggestions generated successfully.", "success");
  } catch (error) {
    setMainStatus(error?.message || "Gemini could not complete the request. Please retry.", "error");
    elements.generateButton.textContent = "Retry";
  } finally {
    const retryLabel = elements.generateButton.textContent === "Retry";
    setGenerationLoading(false);
    if (retryLabel) elements.generateButton.textContent = "Retry";
  }
}

async function writeToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("COPY_FAILED");
  }
}

async function copyWithConfirmation(button, text) {
  if (!text) return;
  try {
    const originalLabel = button.textContent;
    await writeToClipboard(text);
    button.textContent = "Copied";
    window.setTimeout(() => {
      button.textContent = originalLabel;
    }, 1200);
  } catch (error) {
    setMainStatus("Chrome could not copy this suggestion.", "error");
  }
}

elements.settingsButton.addEventListener("click", () => openSettings());
elements.themeButton.addEventListener("click", toggleTheme);
elements.backButton.addEventListener("click", closeSettings);
elements.analyzeButton.addEventListener("click", analyzeSerp);
elements.saveKeyButton.addEventListener("click", saveApiKey);
elements.testConnectionButton.addEventListener("click", testConnection);
elements.removeKeyButton.addEventListener("click", removeApiKey);
elements.generateButton.addEventListener("click", () => generateSuggestions(false));
elements.regenerateButton.addEventListener("click", () => generateSuggestions(true));
elements.copyTitleButton.addEventListener("click", () => copyWithConfirmation(elements.copyTitleButton, currentSuggestions?.title));
elements.copyDescriptionButton.addEventListener("click", () => copyWithConfirmation(elements.copyDescriptionButton, currentSuggestions?.description));
elements.copyUrlButton.addEventListener("click", () => copyWithConfirmation(elements.copyUrlButton, currentSuggestions?.url));
elements.copyAllButton.addEventListener("click", () => copyWithConfirmation(
  elements.copyAllButton,
  currentSuggestions
    ? `SEO Title:\n${currentSuggestions.title}\n\nMeta Description:\n${currentSuggestions.description}\n\nURL:\n${currentSuggestions.url}`
    : ""
));

initialize();
