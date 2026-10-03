import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/client.ts";
import { envString } from "../config/env.ts";
import { createLLMProvider } from "../llm/index.ts";
import type { LLMProvider } from "../llm/provider.ts";

/** Всё, что нужно обработчикам бота. В тестах подменяется через setServices(). */
export interface Services {
  db: PrismaClient;
  llm: LLMProvider | null;
  keys: { google?: string; firecrawl?: string; pagespeed?: string };
}

let current: Services | undefined;

export function getServices(): Services {
  if (!current) {
    current = {
      db: prisma,
      llm: createLLMProvider(),
      keys: {
        google: envString("GOOGLE_PLACES_API_KEY"),
        firecrawl: envString("FIRECRAWL_API_KEY"),
        pagespeed: envString("PAGESPEED_API_KEY"),
      },
    };
  }
  return current;
}

export function setServices(services: Services): void {
  current = services;
}
