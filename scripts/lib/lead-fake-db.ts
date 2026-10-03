// Fake-db для leads/ai тестов: business+websiteAnalysis+lead+outreach+note+user, в памяти.
export function createLeadFakeDb() {
  const businesses = new Map<string, any>();
  const analyses = new Map<string, any>();
  const leads = new Map<string, any>();
  const outreach: any[] = [];
  const notes: any[] = [];
  const users = new Map<string, any>();
  const apiUsageLogs: any[] = [];
  let n = 0;
  const nextId = (p: string) => `${p}_${++n}`;

  function leadRow(id: string) {
    const lead = leads.get(id);
    if (!lead) return null;
    const business = businesses.get(lead.businessId);
    return { ...lead, business: { ...business, websiteAnalysis: analyses.get(business.id) ?? null }, notes: notes.filter((x) => x.leadId === id), outreachMessages: outreach.filter((x) => x.leadId === id) };
  }

  return {
    _seedBusiness(b: any) { businesses.set(b.id, b); },
    _seedAnalysis(businessId: string, a: any) { analyses.set(businessId, a); },
    business: {
      async findUniqueOrThrow({ where, include }: any) {
        const b = businesses.get(where.id);
        if (!b) throw new Error("not found");
        return include?.websiteAnalysis ? { ...b, websiteAnalysis: analyses.get(b.id) ?? null } : b;
      },
    },
    lead: {
      async upsert({ where, update, create }: any) {
        const existingId = [...leads.values()].find((l) => l.businessId === where.businessId)?.id;
        if (existingId) { Object.assign(leads.get(existingId), update); return leads.get(existingId); }
        const id = nextId("lead");
        const row = { id, businessId: where.businessId, crmStatus: "NEW", isFavorite: false, offeredPrice: null, salesBrief: null, createdAt: new Date(), ...create };
        leads.set(id, row);
        return row;
      },
      async findUnique({ where, include }: any) {
        const row = leadRow(where.id);
        return row;
      },
      async findUniqueOrThrow({ where }: any) {
        const l = leads.get(where.id);
        if (!l) throw new Error("not found");
        return l;
      },
      async update({ where, data }: any) {
        Object.assign(leads.get(where.id), data);
        return leads.get(where.id);
      },
      async findMany({ include }: any) {
        return [...leads.values()].map((l) => leadRow(l.id));
      },
    },
    note: { async create({ data }: any) { notes.push({ ...data, id: nextId("note"), createdAt: new Date() }); } },
    outreach: { async create({ data }: any) { outreach.push({ ...data, id: nextId("out"), createdAt: new Date() }); } },
    user: {
      async upsert({ where, create }: any) {
        const existing = users.get(where.telegramId);
        if (existing) return existing;
        const row = { id: nextId("user"), settings: {}, ...create };
        users.set(where.telegramId, row);
        return row;
      },
      async update({ where, data }: any) {
        const u = [...users.values()].find((x) => x.id === where.id);
        Object.assign(u, data);
        return u;
      },
    },
    apiUsageLog: { async create({ data }: any) { apiUsageLogs.push(data); }, async findMany() { return apiUsageLogs; } },
    searchJob: {
      async findUniqueOrThrow({ where }: any) {
        const j = (this as any)._jobs?.get(where.id);
        if (!j) throw new Error("job not found in test fake");
        return { ...j };
      },
      async updateMany() { return { count: 1 }; },
      async update() { return {}; },
    },
    _leads: leads,
    _outreach: outreach,
    _apiUsageLogs: apiUsageLogs,
  };
}
