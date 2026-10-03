import { PrismaClient } from "@prisma/client";

// Ленивая инициализация: PrismaClient создаётся при первом обращении к базе,
// а не при импорте модуля (важно для тестов и для старта без БД).
let instance: PrismaClient | undefined;

function getClient(): PrismaClient {
  if (!instance) {
    instance = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }
  return instance;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient() as any;
    const value = client[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});
