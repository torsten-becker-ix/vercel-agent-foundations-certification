import Image from "next/image";
import Link from "next/link";

import {
  type ProductResultsProps,
  resultsHeading,
  seeAllHref,
} from "./product-results-text";

/** Search results as a horizontally scrollable row of product cards. */
export function ProductResults(props: ProductResultsProps) {
  const visible = props.products.filter(
    (product) => !props.shownBefore.has(product.id),
  );
  if (visible.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Same products as shown above.
      </p>
    );
  }
  const title = resultsHeading(
    props,
    visible.length,
    props.products.length - visible.length,
  );
  const href = seeAllHref(props);

  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{title}</p>
      {/* Each card is a link, so keyboard users scroll the row by tabbing. */}
      <ul className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pt-1 pb-2">
        {visible.map((product) => (
          <li className="w-36 shrink-0 snap-start" key={product.id}>
            <Link
              className="group block overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              href={`/products/${product.id}`}
            >
              <div className="relative aspect-square overflow-hidden bg-secondary">
                {product.image !== null ? (
                  <Image
                    // Decorative: the product name is the link text.
                    alt=""
                    className="object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                    fill
                    sizes="144px"
                    src={product.image}
                  />
                ) : null}
              </div>
              <div className="p-2.5">
                <p className="line-clamp-2 text-xs font-medium text-foreground">
                  {product.name}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {product.priceFormatted}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {href !== null ? (
        <Link
          className="self-start text-xs font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
          href={href}
        >
          See all {props.total} results
        </Link>
      ) : null}
    </section>
  );
}
