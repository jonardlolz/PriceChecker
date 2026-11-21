import { useState } from 'react';
import { api } from '../api.js';
import CameraScanner from './CameraScanner.jsx';
import { Field } from './Login.jsx';

const EMPTY = { productId: '', barcode: '', productName: '', price: '' };

/**
 * Add a new shared product (any store; includes "your price"), or edit an existing
 * shared product (admin only; no price — prices are edited per store).
 * Pass `initial` with an `id` to edit; without an `id` (e.g. `{ barcode }`) to prefill a new one.
 */
export default function ProductForm({ initial, title, onCancel, onSaved, onError, autoFocusField = 'productName' }) {
  const isEdit = initial?.id != null;
  const [form, setForm] = useState(() => ({
    ...EMPTY,
    ...(initial && {
      productId: initial.productId ?? '',
      barcode: initial.barcode ?? '',
      productName: initial.productName ?? '',
    }),
  }));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const saved = isEdit ? await api.updateProduct(initial.id, form) : await api.createProduct(form);
      onSaved(saved);
    } catch (err) {
      if (Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else onError(err);
      setBusy(false);
    }
  };

  return (
    <form className="card product-form" onSubmit={submit}>
      <h2>{title ?? (isEdit ? 'Edit shared product' : 'Add product')}</h2>
      <p className="muted">
        {isEdit
          ? 'Changes apply to every store. Prices are not affected.'
          : 'The product is shared with all stores. Your price is only for your store.'}
      </p>
      <div className="grid">
        <Field label="Product Name" error={errors.productName}>
          <input value={form.productName} onChange={set('productName')} autoFocus={autoFocusField === 'productName'} />
        </Field>
        {!isEdit && (
          <Field label="Your price (optional)" error={errors.price}>
            <input value={form.price} onChange={set('price')} inputMode="decimal" placeholder="0.00" />
          </Field>
        )}
        <Field label="Product ID" error={errors.productId}>
          <input value={form.productId} onChange={set('productId')} autoFocus={autoFocusField === 'productId'} />
        </Field>
        <Field label="Barcode" error={errors.barcode}>
          <div className="inline">
            <input value={form.barcode} onChange={set('barcode')} className="mono" />
            <button type="button" className="secondary small" onClick={() => setCamera((c) => !c)}>
              {camera ? 'Close' : 'Scan'}
            </button>
          </div>
        </Field>
      </div>
      {camera && (
        <CameraScanner
          onDetected={(text) => {
            setForm((f) => ({ ...f, barcode: text }));
            setCamera(false);
          }}
        />
      )}
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
