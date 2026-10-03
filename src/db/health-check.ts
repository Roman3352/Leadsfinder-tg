import { prisma } from "./client.ts";

/**
 * Базовый health check:
 * 1. соединение с БД живо (SELECT 1)
 * 2. миграции применены (все ожидаемые таблицы существуют)
 */
async function healthCheck() {
  const expectedTables = [
    "User",
    "SearchJob",
    "Business",
    "SearchJobBusiness",
    "WebsiteAnalysis",
    "Lead",
    "Outreach",
    "Note",
    "ApiUsageLog",
  ];

  try {
    // 1. соединение живо
    await prisma.$queryRaw`SELECT 1`;
    console.log("✅ DB connection OK");

    // 2. проверяем, что все таблицы схемы существуют
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
    `;
    const existingTables = new Set(rows.map((r) => r.table_name));

    const missing = expectedTables.filter((t) => !existingTables.has(t));

    if (missing.length > 0) {
      console.error("❌ Missing tables (миграция не применена?):", missing);
      process.exit(1);
    }

    console.log(`✅ All ${expectedTables.length} expected tables present`);
    process.exit(0);
  } catch (err) {
    console.error("❌ DB health check failed:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

healthCheck();
