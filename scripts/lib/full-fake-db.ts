// Полноценная in-memory заглушка Prisma, покрывающая ровно те запросы, которые
// реально делает наш код (search -> analysis -> scoring -> AI). Не универсальный
// Prisma-mock, а прагматичный fake под конкретные call-sites этого проекта.

export function matchesWhere(row: any, where: any): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("gte" in (cond as any)) {
        if (!row[key] || row[key] < (cond as any).gte) return false;
        continue;
      }
      if ("lte" in (cond as any)) {
        if (!(row[key] <= (cond as any).lte)) return false;
        continue;
      }
      if ("not" in (cond as any) && (cond as any).not === undefined) {
        if (row[key] === undefined || row[key] === null) return false;
        continue;
      }
    }
    if (row[key] !== cond) return false;
  }
  return true;
}

export function createFullFakeDb() {
  let n = 0;
  const nextId = (p: string) => `${p}_${++n}`;

  const users = new Map<string, any>();
  const searchJobs = new Map<string, any>();
  const businesses = new Map<string, any>();
  const businessByPlaceId = new Map<string, string>();
  const links = new Map<string, any>(); // key: searchJobId::businessId
  const analyses = new Map<string, any>(); // key: businessId
  const leads = new Map<string, any>(); // key: id
  const leadByBusiness = new Map<string, string>();
  const outreach: any[] = [];
  const notes: any[] = [];
  const apiUsageLogs: any[] = [];

  function withInclude(business: any, include: any) {
    if (!include?.websiteAnalysis) return business;
    return { ...business, websiteAnalysis: analyses.get(business.id) ?? null };
  }

  function leadRow(id: string, include?: any) {
    const lead = leads.get(id);
    if (!lead) return null;
    if (!include) return { ...lead };
    const business = businesses.get(lead.businessId);
    return {
      ...lead,
      business: withInclude(business, include.business?.include),
      notes: include.notes ? notes.filter((x) => x.leadId === id) : undefined,
      outreachMessages: include.outreachMessages ? outreach.filter((x) => x.leadId === id) : undefined,
    };
  }

  return {
    _state: { users, searchJobs, businesses, links, analyses, leads, outreach, notes, apiUsageLogs },

    user: {
      async upsert({ where, create }: any) {
        const existing = [...users.values()].find((u) => u.telegramId === where.telegramId);
        if (existing) return existing;
        const row = { id: nextId("user"), settings: {}, ...create };
        users.set(row.id, row);
        return row;
      },
      async update({ where, data }: any) {
        Object.assign(users.get(where.id), data);
        return users.get(where.id);
      },
    },

    searchJob: {
      async findUniqueOrThrow({ where }: any) {
        const j = searchJobs.get(where.id);
        if (!j) throw new Error("job not found");
        return { ...j };
      },
      async findFirst({ where }: any) {
        return [...searchJobs.values()].find((j) => matchesWhere(j, where)) ?? null;
      },
      async update({ where, data }: any) {
        const j = searchJobs.get(where.id)!;
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in (v as any)) (j as any)[k] += (v as any).increment;
          else (j as any)[k] = v;
        }
        return { ...j };
      },
      async updateMany({ where, data }: any) {
        const j = searchJobs.get(where.id);
        if (!j) return { count: 0 };
        const condField = Object.keys(where).find((k) => k !== "id");
        if (condField && !((j as any)[condField] <= (where as any)[condField].lte)) return { count: 0 };
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in (v as any)) (j as any)[k] += (v as any).increment;
        }
        return { count: 1 };
      },
      _seed(job: any) {
        searchJobs.set(job.id, job);
      },
    },

    business: {
      async upsert({ where, update, create }: any) {
        const existingId = businessByPlaceId.get(where.googlePlaceId);
        if (existingId) {
          Object.assign(businesses.get(existingId), update);
          return businesses.get(existingId);
        }
        const id = nextId("biz");
        const row = { id, googlePlaceId: where.googlePlaceId, ...create };
        businesses.set(id, row);
        businessByPlaceId.set(where.googlePlaceId, id);
        return row;
      },
      async findUniqueOrThrow({ where, include }: any) {
        const b = businesses.get(where.id);
        if (!b) throw new Error("business not found");
        return withInclude(b, include);
      },
      async update({ where, data }: any) {
        Object.assign(businesses.get(where.id)!, data);
        return businesses.get(where.id);
      },
      _seed(b: any) {
        businesses.set(b.id, b);
        if (b.googlePlaceId) businessByPlaceId.set(b.googlePlaceId, b.id);
      },
    },

    searchJobBusiness: {
      async upsert({ where }: any) {
        const key = `${where.searchJobId_businessId.searchJobId}::${where.searchJobId_businessId.businessId}`;
        links.set(key, { searchJobId: where.searchJobId_businessId.searchJobId, businessId: where.searchJobId_businessId.businessId });
        return links.get(key);
      },
      async findMany({ where }: any) {
        return [...links.values()].filter((l) => l.searchJobId === where.searchJobId);
      },
    },

    websiteAnalysis: {
      async findUnique({ where }: any) {
        return analyses.get(where.businessId) ?? null;
      },
      async findFirst({ where }: any) {
        const rows = [...analyses.values()].filter((a) => matchesWhere(a, where));
        const field = "quickCheckedAt" in where ? "quickCheckedAt" : "deepAnalyzedAt" in where ? "deepAnalyzedAt" : "pagespeedCheckedAt";
        rows.sort((a, b) => (b[field]?.getTime() ?? 0) - (a[field]?.getTime() ?? 0));
        return rows[0] ?? null;
      },
      async upsert({ where, update, create }: any) {
        const existing = analyses.get(where.businessId);
        const row = existing ? { ...existing, ...update } : { businessId: where.businessId, ...create };
        analyses.set(where.businessId, row);
        return row;
      },
      async update({ where, data }: any) {
        const existing = analyses.get(where.businessId) ?? { businessId: where.businessId };
        const updated = { ...existing, ...data };
        analyses.set(where.businessId, updated);
        return updated;
      },
    },

    lead: {
      async upsert({ where, update, create }: any) {
        const existingId = leadByBusiness.get(where.businessId);
        if (existingId) {
          Object.assign(leads.get(existingId), update);
          return leads.get(existingId);
        }
        const id = nextId("lead");
        const row = { id, businessId: where.businessId, crmStatus: "NEW", isFavorite: false, offeredPrice: null, salesBrief: null, createdAt: new Date(), ...create };
        leads.set(id, row);
        leadByBusiness.set(where.businessId, id);
        return row;
      },
      async findUnique({ where, include }: any) {
        return leadRow(where.id, include);
      },
      async findUniqueOrThrow({ where }: any) {
        const l = leads.get(where.id);
        if (!l) throw new Error("lead not found");
        return l;
      },
      async update({ where, data }: any) {
        Object.assign(leads.get(where.id)!, data);
        return leads.get(where.id);
      },
      async findMany({ include }: any) {
        return [...leads.keys()].map((id) => leadRow(id, include));
      },
    },

    note: {
      async create({ data }: any) {
        notes.push({ ...data, id: nextId("note"), createdAt: new Date() });
      },
    },
    outreach: {
      async create({ data }: any) {
        outreach.push({ ...data, id: nextId("out"), createdAt: new Date() });
      },
    },
    apiUsageLog: {
      async create({ data }: any) {
        apiUsageLogs.push({ ...data, createdAt: new Date() });
      },
      async findMany({ where }: any) {
        if (!where) return apiUsageLogs;
        return apiUsageLogs.filter((l) => matchesWhere(l, where));
      },
    },
  };
}
