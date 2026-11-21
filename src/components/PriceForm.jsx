import { useState } from 'react';
import { api } from '../api.js';

/** Small inline form to set this store's price for one product. */
export default function PriceForm({ product, onSaved, onCancel, onError, autoFocus = true }) {
  const [price, setPrice] = useState(product.price != null ? Number(product.price).toFixed(2) : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSaved(await api.setPrice(product.id, price));
    } catch (err) {
      if (err.fieldErrors.price) setError(err.fieldErrors.price);
      else onError?.(err);
      setBusy(false);
    }
  };

  return (
    <form className="price-form" onSubmit={submit}>
      <div className="inline">
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="decimal"
          placeholder="0.00"
          aria-label={`Your price for ${product.productName}`}
          autoFocus={autoFocus}
        />
        <button type="submit" className="small" disabled={busy || !price.trim()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {onCancel && (
          <button type="button" className="secondary small" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {error && <small className="error">{error}</small>}
    </form>
  );
}
