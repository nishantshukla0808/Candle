'use client';
import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Zap, Flame, BookOpen, Shield, LogOut, ChevronRight, Star, Lock, CheckCircle } from 'lucide-react';
import { BottomNav, TopBar } from '../dashboard/page';
import { getLevel, getNextLevel, getLevelProgress, LEVEL_NAMES, BADGES as ALL_BADGES } from '@/lib/lessonData';

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
    if (status === 'authenticated') fetchProfile();
  }, [status]);

  const fetchProfile = async () => {
    try {
      const res = await fetch('/api/user/profile');
      if (res.ok) setProfile((await res.json()).user);
    } catch (e) {}
    setLoading(false);
  };

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#131F24' }}>
        <div className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: '#1CB0F6', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  const xp = profile.xp || 0;
  const levelInfo = getLevel(xp);
  const nextLevel = getNextLevel(xp);
  const progress = getLevelProgress(xp);
  const streak = profile.streak || 0;
  const badges = profile.badges || [];
  const completedLessons = profile.completedLessons || [];

  const BADGE_INFO = {
    'first-quest': { icon: Star, name: 'First Lesson', desc: 'Complete your first lesson', color: '#FFD700' },
    'market-apprentice': { icon: BookOpen, name: 'Stock Market Basics', desc: 'Complete Module 1', color: '#58CC02' },
    'quiz-master': { icon: CheckCircle, name: 'Perfect Score', desc: 'Score 100% on any quiz', color: '#1CB0F6' },
    'streak-warrior': { icon: Flame, name: '3-Day Streak', desc: 'Maintain a 3-day streak', color: '#FF9600' },
    'knowledge-seeker': { icon: Zap, name: 'Level 3 Scholar', desc: 'Reach Level 3', color: '#A560F5' },
    'fundamental-sage': { icon: Shield, name: 'Fundamental Analysis', desc: 'Complete Module 2', color: '#4ECDC4' },
  };

  return (
    <div className="min-h-screen pb-24" style={{ background: '#131F24' }}>
      <TopBar xp={xp} streak={streak} title="Profile" />

      <div className="max-w-lg mx-auto px-4 py-5 space-y-4">
        {/* Avatar + Name */}
        <div className="c-card p-5 text-center">
          <div className="w-20 h-20 rounded-full mx-auto mb-3 flex items-center justify-center text-3xl font-black"
            style={{ background: 'linear-gradient(135deg, #1CB0F6, #A560F5)', color: 'white' }}>
            {profile.name?.charAt(0)?.toUpperCase()}
          </div>
          <h2 className="text-xl font-black text-white">{profile.name}</h2>
          <p className="text-xs mt-1" style={{ color: '#8DA8B5' }}>{profile.email}</p>
          <div className="flex items-center justify-center gap-1.5 mt-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black"
              style={{ background: '#1CB0F6', color: 'white' }}>{levelInfo.level}</div>
            <span className="text-sm font-bold" style={{ color: '#1CB0F6' }}>{levelInfo.name}</span>
          </div>

          {/* XP Progress */}
          <div className="mt-4">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="font-bold text-white">{xp.toLocaleString()} XP</span>
              {nextLevel ? (
                <span style={{ color: '#8DA8B5' }}>Level {nextLevel.level}: {nextLevel.minXP} XP</span>
              ) : (
                <span style={{ color: '#58CC02' }}>Max Level!</span>
              )}
            </div>
            <div className="xp-track">
              <div className="xp-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: Zap, label: 'Total XP', value: xp.toLocaleString(), color: '#FFD700' },
            { icon: Flame, label: 'Day Streak', value: streak, color: '#FF9600' },
            { icon: BookOpen, label: 'Lessons Done', value: completedLessons.length, color: '#58CC02' },
            { icon: Shield, label: 'Badges', value: badges.length, color: '#A560F5' },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="c-card p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: `${color}18` }}>
                <Icon size={20} style={{ color }} />
              </div>
              <div>
                <p className="text-lg font-black text-white">{value}</p>
                <p className="text-xs" style={{ color: '#8DA8B5' }}>{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Level Journey */}
        <div className="c-card p-4">
          <h3 className="text-sm font-black text-white mb-3">Level Journey</h3>
          <div className="space-y-2">
            {LEVEL_NAMES.map(lvl => {
              const reached = xp >= lvl.minXP;
              const isCurrent = levelInfo.level === lvl.level;
              return (
                <div key={lvl.level} className="flex items-center gap-3 p-2.5 rounded-xl transition-all"
                  style={{
                    background: isCurrent ? 'rgba(28,176,246,0.1)' : reached ? 'rgba(88,204,2,0.05)' : 'transparent',
                    border: `1.5px solid ${isCurrent ? '#1CB0F6' : reached ? 'rgba(88,204,2,0.25)' : '#2D4A58'}`,
                  }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0"
                    style={{ background: isCurrent ? '#1CB0F6' : reached ? 'rgba(88,204,2,0.15)' : '#243B47', color: isCurrent ? 'white' : reached ? '#58CC02' : '#5C7A87' }}>
                    {lvl.level}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-bold ${isCurrent ? 'text-white' : reached ? 'text-white' : ''}`}
                      style={{ color: isCurrent ? '#fff' : reached ? '#fff' : '#5C7A87' }}>{lvl.name}</p>
                    <p className="text-xs" style={{ color: '#5C7A87' }}>{lvl.minXP.toLocaleString()} XP</p>
                  </div>
                  {isCurrent ? (
                    <span className="text-xs font-black px-2 py-0.5 rounded-full" style={{ background: 'rgba(28,176,246,0.2)', color: '#1CB0F6' }}>Current</span>
                  ) : reached ? (
                    <CheckCircle size={16} style={{ color: '#58CC02' }} />
                  ) : (
                    <Lock size={14} style={{ color: '#5C7A87' }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Badges */}
        <div className="c-card p-4">
          <h3 className="text-sm font-black text-white mb-3">Badges</h3>
          <div className="grid grid-cols-3 gap-3">
            {Object.entries(BADGE_INFO).map(([id, badge]) => {
              const earned = badges.includes(id);
              const Icon = badge.icon;
              return (
                <div key={id} className="flex flex-col items-center gap-1.5 p-3 rounded-xl text-center transition-all"
                  style={{
                    background: earned ? `${badge.color}12` : '#1C2F39',
                    border: `1.5px solid ${earned ? `${badge.color}40` : '#2D4A58'}`,
                    opacity: earned ? 1 : 0.4,
                  }}>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center"
                    style={{ background: earned ? `${badge.color}20` : '#243B47' }}>
                    <Icon size={20} style={{ color: earned ? badge.color : '#5C7A87' }} />
                  </div>
                  <p className="text-xs font-bold text-white leading-tight">{badge.name}</p>
                  {earned && <span className="text-xs" style={{ color: badge.color }}>Earned</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Sign out */}
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold text-sm transition-all"
          style={{ background: 'rgba(255,75,75,0.08)', border: '1.5px solid rgba(255,75,75,0.3)', color: '#FF4B4B' }}
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>

      <BottomNav />
    </div>
  );
}
