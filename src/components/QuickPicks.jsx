import { useMoney } from '../money.js';

/** This store's pinned products as big tap targets on the scanner screen. */
export default function QuickPicks({ items, onPick }) {
  const money = useMoney();
  if (!items.length) {
    return (
      <p className="muted quick-empty">
        Tip: pin items you sell all day (eggs, ice, candy…) with ☆ to get quick-pick buttons here.
      </p>
    );
  }
  return (
    <section className="quick-picks" aria-label="Quick picks">
      {items.map((p) => (
        <button key={p.id} type="button" className="quick-pick" onClick={() => onPick(p)}>
          <span className="quick-name">{p.productName}</span>
          <span className={p.price != null ? 'quick-price' : 'quick-price none'}>
            {p.price != null ? money(p.price) : 'no price'}
          </span>
        </button>
      ))}
    </section>
  );
}

/** Pin / unpin toggle for a product. */
export function PinButton({ product, onToggle, busy, className = 'secondary small' }) {
  return (
    <button
      type="button"
      className={`${className} pin${product.isFavorite ? ' on' : ''}`}
      onClick={() => onToggle(product)}
      disabled={busy}
      aria-pressed={product.isFavorite}
      title={product.isFavorite ? 'Remove from quick picks' : 'Add to quick picks'}
    >
      {product.isFavorite ? '★' : '☆'}
    </button>
  );
}
