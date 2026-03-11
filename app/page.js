'use client';
import { useState, useEffect } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { TrendingUp, BookOpen, Trophy, Zap, ChevronRight, Eye, EyeOff } from 'lucide-react';

// Candle mascot SVG
function CandleMascot({ size = 120 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Body - coin shape */}
      <circle cx="60" cy="70" r="38" fill="#FFD700" />
      <circle cx="60" cy="70" r="32" fill="#FFC200" />
      {/* Shine */}
      <ellipse cx="50" cy="56" rx="8" ry="5" fill="rgba(255,255,255,0.35)" transform="rotate(-25 50 56)" />
      {/* Eyes */}
      <circle cx="51" cy="66" r="5" fill="white" />
      <circle cx="69" cy="66" r="5" fill="white" />
      <circle cx="52.5" cy="67.5" r="3" fill="#1C2F39" />
      <circle cx="70.5" cy="67.5" r="3" fill="#1C2F39" />
      {/* Eye shine */}
      <circle cx="53.5" cy="66.5" r="1" fill="white" />
      <circle cx="71.5" cy="66.5" r="1" fill="white" />
      {/* Smile */}
      <path d="M 50 78 Q 60 86 70 78" stroke="#1C2F39" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      {/* Chart lines on body */}
      <polyline points="44,75 49,68 55,72 62,62 70,65 76,58" stroke="rgba(28,48,57,0.4)" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* Candle flame */}
      <ellipse cx="60" cy="28" rx="8" ry="12" fill="#FF9600" />
      <ellipse cx="60" cy="24" rx="5" ry="8" fill="#FFD700" />
      <ellipse cx="60" cy="21" rx="3" ry="5" fill="#FFF" opacity="0.6" />
      {/* Candle stick */}
      <rect x="56" y="38" width="8" height="12" rx="2" fill="#FFD700" />
      {/* Arms */}
      <path d="M 25 70 Q 15 60 22 52" stroke="#FFD700" strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M 95 70 Q 105 60 98 52" stroke="#FFD700" strokeWidth="7" strokeLinecap="round" fill="none" />
      {/* Left hand holding chart */}
      <rect x="10" y="44" width="14" height="10" rx="3" fill="#58CC02" />
      <polyline points="12,52 14,48 16,50 18,45 20,47 22,44" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export default function HomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [mode, setMode] = useState('landing');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') router.push('/dashboard');
  }, [status, router]);

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
      if (!res.ok) { setError(data.error || 'Registration failed'); return; }
      const result = await signIn('credentials', { email: form.email, password: form.password, redirect: false });
      if (result?.ok) router.push('/dashboard');
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
      else router.push('/dashboard');
    } catch { setError('Login failed'); }
    finally { setLoading(false); }
  };

  if (mode === 'login' || mode === 'register') {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: '#131F24' }}>
        {/* Header */}
        <div className="p-4 pt-8 text-center">
          <CandleMascot size={80} />
          <h1 className="text-2xl font-black text-white mt-2">CANDLE</h1>
          <p className="text-candle-muted text-sm">Master the stock market</p>
        </div>

        <div className="flex-1 px-5 pt-4 pb-8 max-w-md mx-auto w-full">
          {/* Tabs */}
          <div className="flex rounded-xl p-1 mb-6" style={{ background: '#1C2F39' }}>
            <button
              onClick={() => { setMode('login'); setError(''); }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${mode === 'login' ? 'bg-candle-blue text-white' : 'text-candle-muted'}`}
            >Sign In</button>
            <button
              onClick={() => { setMode('register'); setError(''); }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${mode === 'register' ? 'bg-candle-blue text-white' : 'text-candle-muted'}`}
            >Create Account</button>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-xl text-sm font-semibold text-center" style={{ background: 'rgba(255,75,75,0.12)', border: '1.5px solid rgba(255,75,75,0.4)', color: '#FF4B4B' }}>
              {error}
            </div>
          )}

          <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-3">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-bold text-candle-muted uppercase tracking-wider mb-1.5">Your Name</label>
                <input
                  type="text" placeholder="e.g. Rahul Sharma"
                  value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  required
                  className="w-full px-4 py-3.5 rounded-xl text-white font-semibold text-sm focus:outline-none focus:ring-2"
                  style={{ background: '#1C2F39', border: '2px solid #2D4A58', fontFamily: 'Nunito' }}
                  onFocus={e => e.target.style.borderColor = '#1CB0F6'}
                  onBlur={e => e.target.style.borderColor = '#2D4A58'}
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-candle-muted uppercase tracking-wider mb-1.5">Email</label>
              <input
                type="email" placeholder="your@email.com"
                value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                required
                className="w-full px-4 py-3.5 rounded-xl text-white font-semibold text-sm focus:outline-none"
                style={{ background: '#1C2F39', border: '2px solid #2D4A58', fontFamily: 'Nunito' }}
                onFocus={e => e.target.style.borderColor = '#1CB0F6'}
                onBlur={e => e.target.style.borderColor = '#2D4A58'}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-candle-muted uppercase tracking-wider mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'} placeholder="Min 6 characters"
                  value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                  required
                  className="w-full px-4 py-3.5 pr-12 rounded-xl text-white font-semibold text-sm focus:outline-none"
                  style={{ background: '#1C2F39', border: '2px solid #2D4A58', fontFamily: 'Nunito' }}
                  onFocus={e => e.target.style.borderColor = '#1CB0F6'}
                  onBlur={e => e.target.style.borderColor = '#2D4A58'}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-candle-muted">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div className="pt-2">
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </div>
          </form>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px" style={{ background: '#2D4A58' }} />
            <span className="text-candle-muted text-xs font-bold">OR</span>
            <div className="flex-1 h-px" style={{ background: '#2D4A58' }} />
          </div>

          <button
            onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
            className="btn-secondary flex items-center justify-center gap-3"
          >
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <p className="text-center text-candle-muted text-xs mt-6">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
              className="text-candle-blue font-bold">
              {mode === 'login' ? 'Sign Up' : 'Sign In'}
            </button>
          </p>
        </div>
      </div>
    );
  }

  // Landing page
  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#131F24' }}>
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-12 text-center">
        {/* Mascot */}
        <div className="mb-6" style={{ animation: 'bounceIn 0.6s ease' }}>
          <CandleMascot size={140} />
        </div>

        <h1 className="text-4xl font-black text-white mb-2 tracking-tight">CANDLE</h1>
        <p className="text-lg font-bold" style={{ color: '#1CB0F6' }}>Learn. Invest. Level Up.</p>
        <p className="text-candle-muted text-sm mt-3 max-w-xs leading-relaxed">
          Master the Indian stock market through bite-sized lessons, daily challenges, and real quiz battles.
        </p>

        {/* Feature pills */}
        <div className="flex flex-wrap justify-center gap-2 mt-6 mb-8">
          {[
            { icon: BookOpen, label: 'Zerodha Varsity Content', color: '#58CC02' },
            { icon: Zap, label: 'XP & Streaks', color: '#FF9600' },
            { icon: Trophy, label: 'Global Leaderboard', color: '#FFD700' },
            { icon: TrendingUp, label: 'AI-Powered Path', color: '#A560F5' },
          ].map(({ icon: Icon, label, color }) => (
            <div key={label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
              style={{ background: `${color}18`, border: `1px solid ${color}40`, color }}>
              <Icon size={12} />{label}
            </div>
          ))}
        </div>

        <div className="w-full max-w-sm space-y-3">
          <button onClick={() => setMode('register')} className="btn-primary">
            Get Started - It's Free
          </button>
          <button onClick={() => setMode('login')} className="btn-secondary">
            I Already Have an Account
          </button>
        </div>

        <p className="text-candle-faint text-xs mt-6">Based on Zerodha Varsity • Free to learn</p>
      </div>
    </div>
  );
}
