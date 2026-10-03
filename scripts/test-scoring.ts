import { createReporter } from "./lib/assert.ts";
import { computeLeadScore, type ScoringInput } from "../src/scoring/score.ts";

const r = createReporter();

const BASE_BUSINESS = { name: "Test GmbH", rating: null, reviewCount: null, phone: null, website: null, hasOpeningHours: false };

function testNoWebsiteScoresHighAndOpportunity() {
  const input: ScoringInput = { niche: "Friseur", business: { ...BASE_BUSINESS, rating: 4.6, reviewCount: 80, phone: "+49123", hasOpeningHours: true }, quickCheck: null, deepPages: [], pagespeed: null };
  const res = computeLeadScore(input);
  r.assert(res.items.some((i) => i.code === "NO_WEBSITE"), "NO_WEBSITE item present");
  r.assert(res.opportunities.some((o) => o.code === "NO_WEBSITE"), "NO_WEBSITE opportunity present");
  r.assert(res.opportunities.some((o) => o.code === "LANDING_PAGE"), "LANDING_PAGE suggested for no-website business");
  r.assert(res.score > 60, `high score for no-website solid business, got ${res.score}`);
  r.assert(res.websiteStatus === "NONE", "websiteStatus NONE");
}

function testGoodWebsiteScoresLowNoFakeOpportunities() {
  const qc = {
    reachable: true, https: true, mobileFriendly: true, title: "T", metaDescription: "D", h1: "H",
    hasPhoneLink: true, hasWhatsapp: true, hasContactForm: true, hasBookingKeyword: true,
    hasPortfolioKeyword: true, hasReviewsKeyword: true, hasPricesKeyword: true, hasClearCta: true,
    email: "x@x.de", instagramUrl: null,
  };
  const input: ScoringInput = { niche: "Friseur", business: { ...BASE_BUSINESS, website: "https://good.de", rating: 4.8, reviewCount: 200, phone: "+49", hasOpeningHours: true }, quickCheck: qc as any, deepPages: [], pagespeed: { performanceScore: 95, seoScore: 95, accessibilityScore: 95, coreWebVitals: {} } as any };
  const res = computeLeadScore(input);
  r.assert(res.problems === undefined || true, "sanity");
  const problemCodes = res.items.filter((i) => i.kind === "problem").map((i) => i.code);
  r.assert(problemCodes.length === 0, `no problems for a great site, got ${JSON.stringify(problemCodes)}`);
  r.assert(!res.opportunities.some((o) => o.code === "ONLINE_BOOKING"), "no fake ONLINE_BOOKING when booking already present");
  r.assert(!res.opportunities.some((o) => o.code === "PORTFOLIO_GALLERY"), "no fake PORTFOLIO_GALLERY when portfolio already present");
  r.assert(res.score < 35, `low score for a great site, got ${res.score}`);
}

function testUnverifiedSiteDoesNotClaimProblems() {
  const qc = { reachable: false, https: false, mobileFriendly: false, title: null, metaDescription: null, h1: null, hasPhoneLink: false, hasWhatsapp: false, hasContactForm: false, hasBookingKeyword: false, hasPortfolioKeyword: false, hasReviewsKeyword: false, hasPricesKeyword: false, hasClearCta: false, email: null, instagramUrl: null, error: "timeout" };
  const input: ScoringInput = { niche: "Friseur", business: { ...BASE_BUSINESS, website: "https://slow.de" }, quickCheck: qc as any, deepPages: [], pagespeed: null };
  const res = computeLeadScore(input);
  r.assert(res.websiteStatus === "UNVERIFIED", "websiteStatus UNVERIFIED");
  r.assert(!res.items.some((i) => i.code === "NOT_MOBILE" || i.code === "NO_CTA"), "does not claim mobile/CTA problems when unverified");
}

function testScoreClamped100() {
  const qc = { reachable: true, https: false, mobileFriendly: false, title: null, metaDescription: null, h1: null, hasPhoneLink: false, hasWhatsapp: false, hasContactForm: false, hasBookingKeyword: false, hasPortfolioKeyword: false, hasReviewsKeyword: false, hasPricesKeyword: false, hasClearCta: false, email: null, instagramUrl: null };
  const input: ScoringInput = { niche: "Barber", business: { ...BASE_BUSINESS, website: "https://bad.de", rating: 4.9, reviewCount: 500, phone: "+49", hasOpeningHours: true }, quickCheck: qc as any, deepPages: [], pagespeed: { performanceScore: 10, seoScore: 10, accessibilityScore: 10, coreWebVitals: {} } as any };
  const res = computeLeadScore(input);
  r.assert(res.score <= 100, `score clamped at 100, got ${res.score}`);
}

testNoWebsiteScoresHighAndOpportunity();
testGoodWebsiteScoresLowNoFakeOpportunities();
testUnverifiedSiteDoesNotClaimProblems();
testScoreClamped100();
console.log(`\n${r.pass} passed, ${r.fail} failed`);
if (r.fail > 0) process.exit(1);
