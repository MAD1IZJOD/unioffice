import {
  OllamaModelProvider,
} from "./ollama-model-provider.js";

const provider =
  new OllamaModelProvider();

const result =
  await provider.generate({
    model: "qwen3:8b",

    messages: [
      {
        role: "system",

        content:
          "You are a concise AI assistant.",
      },

      {
        role: "user",

        content:
          "Explain UNI-OFFICE in one sentence.",
      },
    ],

    maxTokens: 500,
  });

console.log("Model:", result.model);

console.log("Response:");

console.log(result.content);

console.log("Usage:");

console.log(result.usage);