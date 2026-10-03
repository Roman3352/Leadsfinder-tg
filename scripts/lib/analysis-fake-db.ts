// Общая fake-db для deep-analysis / pagespeed тестов: business + websiteAnalysis + searchJob budget.
export function createAnalysisFakeDb(job: any, businesses: Record<string, any>, analyses: Record<string, any>) {
  const jobState = { ...job };
  const businessMap = new Map(Object.entries(businesses));
  const analysisMap = new Map(Object.entries(analyses));

  return {
    business: {
      async findUniqueOrThrow({ where }: any) {
        const b = businessMap.get(where.id);
        if (!b) throw new Error("not found");
        return b;
      },
    },
    websiteAnalysis: {
      async findUnique({ where }: any) {
        return analysisMap.get(where.businessId) ?? null;
      },
      async findFirst({ where }: any) {
        const field = "deepAnalyzedAt" in where ? "deepAnalyzedAt" : "pagespeedCheckedAt";
        const rows = [...analysisMap.values()].filter((a) => a.normalizedDomain === where.normalizedDomain && a[field]);
        rows.sort((a, b) => b[field].getTime() - a[field].getTime());
        return rows[0] ?? null;
      },
      async update({ where, data }: any) {
        const existing = analysisMap.get(where.businessId) ?? { businessId: where.businessId };
        const updated = { ...existing, ...data };
        analysisMap.set(where.businessId, updated);
        return updated;
      },
    },
    searchJob: {
      async findUniqueOrThrow() {
        return { ...jobState };
      },
      async update({ data }: any) {
        Object.assign(jobState, data);
        return { ...jobState };
      },
      async updateMany({ where, data }: any) {
        const condField = Object.keys(where).find((k) => k !== "id");
        if (condField) {
          const cond = (where as any)[condField];
          if (!((jobState as any)[condField] <= cond.lte)) return { count: 0 };
        }
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in (v as any)) (jobState as any)[k] += (v as any).increment;
        }
        return { count: 1 };
      },
    },
    apiUsageLog: { async create() { return {}; } },
    _analysisMap: analysisMap,
    _jobState: jobState,
  };
}

export const QUICK_CHECK_BAD = {
  reachable: true, https: true, mobileFriendly: false, title: null, metaDescription: null, h1: null,
  hasPhoneLink: false, hasWhatsapp: false, hasContactForm: false, hasBookingKeyword: false,
  hasPortfolioKeyword: false, hasReviewsKeyword: false, hasPricesKeyword: false, hasClearCta: false,
  email: null, instagramUrl: null,
};

export const QUICK_CHECK_GOOD = {
  ...QUICK_CHECK_BAD, mobileFriendly: true, title: "T", metaDescription: "D", hasClearCta: true, hasReviewsKeyword: true,
};
