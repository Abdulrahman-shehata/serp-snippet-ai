"use strict";

import {
  generateGeminiSuggestions,
  getGeminiErrorDetails,
  getGeminiErrorMessage,
  testGeminiConnection
} from "./gemini.js";

const API_KEY_STORAGE_KEY = "geminiApiKey";
const TEST_MESSAGE = "SERP_SNIPPET_AI_TEST_GEMINI";
const GENERATE_MESSAGE = "SERP_SNIPPET_AI_GENERATE";

async function getApiKeyForRequest() {
  const stored = await chrome.storage.local.get(API_KEY_STORAGE_KEY);
  const apiKey = stored[API_KEY_STORAGE_KEY];
  return typeof apiKey === "string" ? apiKey.trim() : "";
}

async function handleGeminiMessage(message) {
  const apiKey = await getApiKeyForRequest();
  if (!apiKey) {
    return {
      ok: false,
      code: "MISSING_API_KEY",
      error: "The saved API key is missing. Add it again in Settings."
    };
  }

  try {
    if (message.type === TEST_MESSAGE) {
      await testGeminiConnection(apiKey);
      return { ok: true };
    }

    if (message.type === GENERATE_MESSAGE) {
      const suggestions = await generateGeminiSuggestions(
        apiKey,
        message.analysis,
        message.previousSuggestions || null
      );
      return { ok: true, suggestions };
    }
  } catch (error) {
    return {
      ok: false,
      code: error?.code || "GEMINI_ERROR",
      error: getGeminiErrorMessage(error),
      googleError: getGeminiErrorDetails(error)
    };
  }

  return { ok: false, code: "UNKNOWN_MESSAGE", error: "Unsupported Gemini request." };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (![TEST_MESSAGE, GENERATE_MESSAGE].includes(message?.type)) return false;

  handleGeminiMessage(message).then(sendResponse).catch(() => {
    sendResponse({
      ok: false,
      code: "GEMINI_ERROR",
      error: "Gemini could not complete the request. Please retry."
    });
  });
  return true;
});
