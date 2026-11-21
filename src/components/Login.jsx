import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

/** Sign in, or create a new store (tindahan) account. */
export default function Login() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState('login'); // login | signup
  const [form, setForm] = useState({ username: '', password: '', storeName: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const switchMode = () => {
    setMode(signup ? 'login' : 'signup');
    setErrors({});
    setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError('');
    try {
      signIn(signup ? await api.signup(form) : await api.login(form));
    } catch (err) {
      if (Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form className="card login" onSubmit={submit}>
      <h2>{signup ? 'Create your store account' : 'Sign in to your store'}</h2>
      {signup && (
        <Field label="Store name" error={errors.storeName}>
          <input value={form.storeName} onChange={set('storeName')} placeholder="e.g. Aling Nena's Store" autoFocus />
        </Field>
      )}
      <Field label="Username" error={errors.username}>
        <input
          value={form.username}
          onChange={set('username')}
          autoComplete="username"
          autoCapitalize="none"
          autoFocus={!signup}
        />
      </Field>
      <Field label="Password" error={errors.password}>
        <input
          type="password"
          value={form.password}
          onChange={set('password')}
          autoComplete={signup ? 'new-password' : 'current-password'}
        />
      </Field>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy || !form.username || !form.password || (signup && !form.storeName)}>
        {busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
      </button>
      <p className="muted center switch">
        {signup ? 'Already have an account?' : 'New store?'}{' '}
        <button type="button" className="link" onClick={switchMode}>
          {signup ? 'Sign in' : 'Create an account'}
        </button>
      </p>
    </form>
  );
}

export function Field({ label, error, children }) {
  return (
    <label className={error ? 'field has-error' : 'field'}>
      <span>{label}</span>
      {children}
      {error && <small className="error">{error}</small>}
    </label>
  );
}
