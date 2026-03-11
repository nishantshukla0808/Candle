'use client';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CheckCircle, Zap, Flame, Sparkles, Clock, ArrowRight, RotateCcw } from 'lucide-react';
import { BottomNav, TopBar } from '../dashboard/page';

export default function DailyPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [challenge, setChallenge] = useState(null);
  const [profile, setProfile] = useState(null);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiSuggestion, setAiSuggestion] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
    if (status === 'authenticated') fetchData();
  }, [status]);

  const fetchData = async () => {
    try {
      const [cRes, pRes] = await Promise.all([
        fetch('/api/daily-challenge'),
        fetch('/api/user/profile'),
      ]);
      if (cRes.ok) setChallenge((await cRes.json()).challenge);
      if (pRes.ok) setProfile((await pRes.json()).user);
    } catch (e) {}
    setLoading(false);
  };

  const handleAnswer = async (idx) => {
    if (result || challenge?.completed) return;
    setSelectedAnswer(idx);
    const res = await fetch('/api/daily-challenge/complete', { method: 'POST' });
    const data = await res.json();
    setResult({ xpAwarded: data.xpAwarded || 0 });
    // Refresh profile
    const pRes = await fetch('/api/user/profile');
    if (pRes.ok) setProfile((await pRes.json()).user);
  };

  const getAIGuide = async () => {
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) setAiSuggestion((await res.json()).suggestion);
      else setAiSuggestion('Unable to load AI suggestion at this time. Please try again later.');
    } catch (e) {
      setAiSuggestion('Unable to load AI suggestion. Check your connection.');
    }
    setAiLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#131F24' }}>
        <div className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: '#1CB0F6', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  const xp = profile?.xp || 0;
  const streak = profile?.streak || 0;
  const isDone = challenge?.completed || !!result;
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="min-h-screen pb-24" style={{ background: '#131F24' }}>
      <TopBar xp={xp} streak={streak} title="Daily Challenge" />

      <div className="max-w-lg mx-auto px-4 py-5 space-y-4">
        {/* Date & Streak */}
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold" style={{ color: '#8DA8B5' }}>{today}</p>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(255,150,0,0.12)', border: '1.5px solid rgba(255,150,0,0.3)' }}>
            <Flame size={14} style={{ color: '#FF9600' }} />
            <span className="text-xs font-black" style={{ color: '#FF9600' }}>{streak}-day streak</span>
          </div>
        </div>

        {/* Daily Challenge Card */}
        {challenge ? (
          <div className="c-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: '#8DA8B5' }}>Today's Challenge</p>
                <p className="text-sm font-bold" style={{ color: '#1CB0F6' }}>{challenge.title}</p>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
                style={{ background: 'rgba(255,215,0,0.12)', border: '1.5px solid rgba(255,215,0,0.3)' }}>
                <Zap size={14} style={{ color: '#FFD700' }} />
                <span className="text-xs font-black" style={{ color: '#FFD700' }}>+{challenge.xpReward} XP</span>
              </div>
            </div>

            {isDone ? (
              <div className="text-center py-6">
                <CheckCircle size={48} style={{ color: '#58CC02', margin: '0 auto 12px' }} />
                <p className="text-lg font-black text-white">Challenge Complete!</p>
                <p className="text-sm mt-1" style={{ color: '#8DA8B5' }}>Come back tomorrow for a new challenge</p>
                {result?.xpAwarded > 0 && (
                  <div className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bounce-in"
                    style={{ background: 'rgba(255,215,0,0.12)', border: '1.5px solid rgba(255,215,0,0.3)' }}>
                    <Zap size={16} style={{ color: '#FFD700' }} />
                    <span className="font-black" style={{ color: '#FFD700' }}>+{result.xpAwarded} XP earned!</span>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <p className="text-base font-bold text-white mb-4 leading-snug">{challenge.question}</p>
                <div className="space-y-2.5">
                  {challenge.options?.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => handleAnswer(i)}
                      className={`answer-option ${selectedAnswer === i ? 'selected' : ''}`}
                    >
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-black mr-3"
                        style={{ background: selectedAnswer === i ? '#1CB0F6' : '#243B47', color: 'white', flexShrink: 0 }}>
                        {String.fromCharCode(65 + i)}
                      </span>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="c-card p-8 text-center">
            <Clock size={40} style={{ color: '#2D4A58', margin: '0 auto 12px' }} />
            <p className="font-black text-white">No challenge today</p>
          </div>
        )}

        {/* AI Guide section */}
        <div className="c-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(165,96,245,0.15)' }}>
              <Sparkles size={20} style={{ color: '#A560F5' }} />
            </div>
            <div>
              <p className="text-sm font-black text-white">AI Learning Guide</p>
              <p className="text-xs" style={{ color: '#8DA8B5' }}>Personalized suggestions powered by Gemini</p>
            </div>
          </div>

          {aiSuggestion ? (
            <div className="p-3 rounded-xl mb-3"
              style={{ background: 'rgba(165,96,245,0.08)', border: '1.5px solid rgba(165,96,245,0.25)' }}>
              <p className="text-sm leading-relaxed" style={{ color: '#C4A8E8' }}>&#34;{aiSuggestion}&#34;</p>
            </div>
          ) : (
            <p className="text-xs mb-3" style={{ color: '#8DA8B5' }}>
              Get personalized lesson recommendations based on your progress and weak areas.
            </p>
          )}

          <button
            onClick={getAIGuide}
            disabled={aiLoading}
            className="w-full py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2"
            style={{
              background: 'rgba(165,96,245,0.12)', border: '1.5px solid rgba(165,96,245,0.35)',
              color: aiLoading ? '#8DA8B5' : '#A560F5',
            }}
          >
            {aiLoading ? (
              <><div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#A560F5', borderTopColor: 'transparent' }} /> Analyzing your progress...</>
            ) : (
              <><RotateCcw size={14} /> {aiSuggestion ? 'Refresh Suggestion' : 'Get AI Suggestion'}</>
            )}
          </button>
        </div>

        {/* Streak info */}
        <div className="c-card p-4">
          <p className="text-sm font-black text-white mb-3">Your Streak</p>
          <div className="flex gap-1.5">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="flex-1 h-8 rounded-lg flex items-center justify-center" style={{
                background: i < Math.min(streak, 7) ? 'rgba(255,150,0,0.2)' : '#243B47',
                border: `1.5px solid ${i < Math.min(streak, 7) ? 'rgba(255,150,0,0.5)' : '#2D4A58'}`,
              }}>
                {i < Math.min(streak, 7) ? (
                  <Flame size={14} style={{ color: '#FF9600' }} />
                ) : (
                  <div className="w-2 h-2 rounded-full" style={{ background: '#2D4A58' }} />
                )}
              </div>
            ))}
          </div>
          <p className="text-xs mt-2" style={{ color: '#5C7A87' }}>Complete daily challenges to build your streak</p>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
