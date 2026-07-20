import { fetchProducts, fetchCounts, fetchLocations, fetchCategories } from "@/lib/queries";
import { facilityToday } from "@/lib/expiry";
import InventoryApp from "@/components/InventoryApp";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const pick = (key: string, fallback: string) => (typeof sp[key] === "string" ? (sp[key] as string) : fallback);

  const filters = {
    q: pick("q", ""),
    loc: pick("loc", "all"),
    cat: pick("cat", "all"),
    status: pick("status", "all"),
    sort: pick("sort", "expiry"),
    dir: pick("dir", "asc"),
  };

  const today = facilityToday();
  const [rows, allProducts, counts, locations, categories] = await Promise.all([
    fetchProducts(filters, today),
    fetchProducts({}, today),
    fetchCounts(today),
    fetchLocations(),
    fetchCategories(),
  ]);

  return (
    <InventoryApp
      initialProducts={rows}
      allProducts={allProducts}
      counts={counts}
      locations={locations}
      categories={categories}
      today={today}
      filters={filters}
    />
  );
}
