import { cn } from "@/lib/utils";

/** Stock fields shared by `StockInfo` (API) and the chat tool results. */
interface StockLevel {
  stock: number;
  inStock: boolean;
  lowStock: boolean;
}

const pill = "inline-flex items-center rounded-full bg-secondary px-3 py-1";

/**
 * Availability pill used on the product page and in the shopping chat, so
 * both say the same thing. `null` means stock is still loading.
 */
export function StockBadge({
  stock,
  className,
}: {
  stock: StockLevel | null;
  className?: string;
}) {
  if (stock === null) {
    return (
      <span className={cn(pill, "text-muted-foreground", className)}>
        Checking availability…
      </span>
    );
  }
  if (!stock.inStock) {
    return (
      <span className={cn(pill, "text-muted-foreground", className)}>
        Out of stock
      </span>
    );
  }
  if (stock.lowStock && stock.stock > 0) {
    return (
      <span className={cn(pill, "text-foreground", className)}>
        Only {stock.stock} left in stock
      </span>
    );
  }
  return (
    <span className={cn(pill, "text-foreground", className)}>In stock</span>
  );
}
