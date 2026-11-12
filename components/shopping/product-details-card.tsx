"use client";

import Image from "next/image";
import Link from "next/link";
import { useId, useState } from "react";

import { StockBadge } from "@/components/stock-badge";
import { Button } from "@/components/ui/button";
import type { ProductDetail, StockSummary } from "@/lib/tools";
import { cn } from "@/lib/utils";

/** One product in depth: image gallery, price, stock, description, link. */
export function ProductDetailsCard({
  product,
  stock,
}: {
  product: ProductDetail;
  stock: StockSummary;
}) {
  const headingId = useId();
  const [selected, setSelected] = useState(0);
  const image = product.images[selected] ?? product.images[0];
  const count = product.images.length;

  return (
    <article
      aria-labelledby={headingId}
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="relative aspect-square bg-secondary">
        {image !== undefined ? (
          <Image
            alt={
              count > 1
                ? `${product.name}, image ${String(selected + 1)} of ${String(count)}`
                : product.name
            }
            className="object-cover"
            fill
            sizes="320px"
            src={image}
          />
        ) : null}
      </div>

      {count > 1 ? (
        <div
          aria-label="Product images"
          className="flex gap-2 overflow-x-auto px-3 pt-3"
          role="group"
        >
          {product.images.map((src, index) => (
            <button
              aria-label={`Show image ${String(index + 1)} of ${String(count)}`}
              aria-pressed={index === selected}
              className={cn(
                "relative size-12 shrink-0 overflow-hidden rounded-md border bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                index === selected
                  ? "border-foreground"
                  : "border-border hover:border-foreground/40",
              )}
              key={src}
              onClick={() => {
                setSelected(index);
              }}
              type="button"
            >
              <Image
                alt=""
                className="object-cover"
                fill
                sizes="48px"
                src={src}
              />
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-medium text-foreground" id={headingId}>
            {product.name}
          </h3>
          <p className="shrink-0 text-sm text-muted-foreground">
            {product.priceFormatted}
          </p>
        </div>
        <StockBadge className="self-start text-xs" stock={stock} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          {product.description}
        </p>
        <Button asChild className="mt-1 self-start" size="sm" variant="outline">
          <Link href={`/products/${product.id}`}>View product</Link>
        </Button>
      </div>
    </article>
  );
}
