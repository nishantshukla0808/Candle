'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { X, Eye, EyeOff } from 'lucide-react';
import CandleLogo from './CandleLogo';

export default function AuthModal({ isOpen, onClose, onSuccess, message }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  if (!isOpen) return null;

  const handleRegister = async (e) => {
    e.preventDefault();
    if (form.password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Registration failed'); setLoading(false); return; }
      const result = await signIn('credentials', { email: form.email, password: form.password, redirect: false });
      if (result?.ok) { onSuccess?.(); }
      else setError('Login after registration failed');
    } catch { setError('Something went wrong'); }
    finally { setLoading(false); }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const result = await signIn('credentials', { email: form.email, password: form.password, redirect: false });
      if (result?.error) { setError('Incorrect email or password'); }
      else { onSuccess?.(); }
    } catch { setError('Login failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm mx-0 sm:mx-4 rounded-t-2xl sm:rounded-2xl p-5 slide-up"
        style={{ background: '#1C2F39', border: '2px solid #2D4A58' }}
        onClick={e => e.stopPropagation()}>
        
        <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-full" style={{ background: '#243B47' }}>
          <X size={16} style={{ color: '#8DA8B5' }} />
        </button>

        <div className="text-center mb-4">
          <div className="flex justify-center mb-2">
            <CandleLogo size={36} />
          </div>
          <h2 className="text-lg font-black text-white">Sign in to continue</h2>
          {message && (
            <p className="text-xs mt-1" style={{ color: '#1CB0F6' }}>{message}</p>
          )}
        </div>

        <div className="flex rounded-xl p-1 mb-4" style={{ background: '#131F24' }}>
          <button onClick={() => { setMode('login'); setError(''); }}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${mode === 'login' ? 'text-white' : ''}`}
            style={mode === 'login' ? { background: '#1CB0F6', color: 'white' } : { color: '#5C7A87' }}>
            Sign In
          </button>
          <button onClick={() => { setMode('register'); setError(''); }}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${mode === 'register' ? 'text-white' : ''}`}
            style={mode === 'register' ? { background: '#1CB0F6', color: 'white' } : { color: '#5C7A87' }}>
            Create Account
          </button>
        </div>

        {error && (
          <div className="mb-3 p-2.5 rounded-xl text-xs font-semibold text-center"
            style={{ background: 'rgba(255,75,75,0.12)', border: '1.5px solid rgba(255,75,75,0.4)', color: '#FF4B4B' }}>
            {error}
          </div>
        )}

        <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-2.5">
          {mode === 'register' && (
            <input type="text" placeholder="Your Name" required value={form.name}
              onChange={e => setForm({...form, name: e.target.value})}
              className="w-full px-3.5 py-3 rounded-xl text-white text-sm font-semibold focus:outline-none"
              style={{ background: '#131F24', border: '2px solid #2D4A58' }}
            />
          )}
          <input type="email" placeholder="Email" required value={form.email}
            onChange={e => setForm({...form, email: e.target.value})}
            className="w-full px-3.5 py-3 rounded-xl text-white text-sm font-semibold focus:outline-none"
            style={{ background: '#131F24', border: '2px solid #2D4A58' }}
          />
          <div className="relative">
            <input type={showPassword ? 'text' : 'password'} placeholder="Password (min 6 chars)" required value={form.password}
              onChange={e => setForm({...form, password: e.target.value})}
              className="w-full px-3.5 py-3 pr-10 rounded-xl text-white text-sm font-semibold focus:outline-none"
              style={{ background: '#131F24', border: '2px solid #2D4A58' }}
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2">
              {showPassword ? <EyeOff size={16} style={{ color: '#5C7A87' }} /> : <Eye size={16} style={{ color: '#5C7A87' }} />}
            </button>
          </div>
          <button type="submit" className="btn-primary text-sm" disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="flex items-center gap-3 my-3">
          <div className="flex-1 h-px" style={{ background: '#2D4A58' }} />
          <span className="text-xs font-bold" style={{ color: '#5C7A87' }}>OR</span>
          <div className="flex-1 h-px" style={{ background: '#2D4A58' }} />
        </div>

        <button onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
          className="btn-secondary flex items-center justify-center gap-2 text-sm">
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>
      </div>
    </div>
  );
}
