import { createReporter } from "./lib/assert.ts";
import { applyFilters, sortViews } from "../src/leads/repository.ts";
import type { LeadView } from "../src/leads/view.ts";

const r = createReporter();

function view(partial: Partial<LeadView> & { flags: Partial<LeadView["flags"]> }): LeadView {
  const defaultFlags: LeadView["flags"] = {
    noWebsite: false, hasWebsite: true, oldWebsite: false, poorMobile: false, poorPageSpeed: false,
    noWhatsapp: false, noBooking: false, highScore: false, instagram: false, email: false, phone: false,
  };
  return {
    id: "id", businessId: "b", score: 0, emoji: "➖", name: "N", category: null, city: null, rating: null,
    reviewCount: null, phone: null, email: null, instagramUrl: null, websiteUrl: null, mapsUrl: null,
    websiteStatus: "OK", items: [], problems: [], opportunities: [], salesBrief: null, crmStatus: "NEW",
    isFavorite: false, offeredPrice: null, lastContactAt: null, notes: [], latestOutreach: null,
    createdAt: new Date(), ...partial, flags: { ...defaultFlags, ...partial.flags },
  } as LeadView;
}

function testFilters() {
  const views = [
    view({ id: "1", score: 80, flags: { noWebsite: true, hasWebsite: false, highScore: true } }),
    view({ id: "2", score: 40, flags: { poorMobile: true } }),
    view({ id: "3", score: 90, flags: { highScore: true, instagram: true } }),
  ];
  const hot = applyFilters(views, ["hot"]);
  r.assert(hot.length === 2 && hot.every((v) => v.score >= 80), `hot filter -> 2 items, got ${hot.length}`);

  const noWebsiteAndHot = applyFilters(views, ["nowebsite", "hot"]);
  r.assert(noWebsiteAndHot.length === 1 && noWebsiteAndHot[0].id === "1", "combined filters AND together");

  const none = applyFilters(views, []);
  r.assert(none.length === 3, "no filters -> everything");
}

function testSort() {
  const views = [
    view({ id: "a", score: 50, reviewCount: 10, rating: 4.1, createdAt: new Date("2024-01-01") }),
    view({ id: "b", score: 90, reviewCount: 5, rating: 4.9, createdAt: new Date("2024-03-01") }),
    view({ id: "c", score: 70, reviewCount: 200, rating: 3.9, createdAt: new Date("2024-02-01") }),
  ];
  r.assert(sortViews(views, "score").map((v) => v.id).join(",") === "b,c,a", "sort by score desc");
  r.assert(sortViews(views, "reviews").map((v) => v.id).join(",") === "c,a,b", "sort by reviews desc");
  r.assert(sortViews(views, "rating").map((v) => v.id).join(",") === "b,a,c", "sort by rating desc");
  r.assert(sortViews(views, "new").map((v) => v.id).join(",") === "b,c,a", "sort by newest first");
}

testFilters();
testSort();
console.log(`\n${r.pass} passed, ${r.fail} failed`);
if (r.fail > 0) process.exit(1);
