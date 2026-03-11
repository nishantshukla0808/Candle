'use client';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Flame, Zap, BookOpen, Trophy, Star } from 'lucide-react';
import { BottomNav, TopBar } from '../dashboard/page';
import { getLevel } from '@/lib/lessonData';

export default function LeaderboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [leaderboard, setLeaderboard] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
    if (status === 'authenticated') { fetchData(); }
  }, [status]);

  const fetchData = async () => {
    try {
      const [lRes, pRes] = await Promise.all([
        fetch('/api/leaderboard'),
        fetch('/api/user/profile'),
      ]);
      if (lRes.ok) setLeaderboard((await lRes.json()).leaderboard);
      if (pRes.ok) setProfile((await pRes.json()).user);
    } catch (e) {}
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#131F24' }}>
        <div className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: '#1CB0F6', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  const currentUserEmail = session?.user?.email;
  const medals = ['#FFD700', '#C0C0C0', '#CD7F32'];

  return (
    <div className="min-h-screen pb-24" style={{ background: '#131F24' }}>
      <TopBar xp={profile?.xp || 0} streak={profile?.streak || 0} title="Leaderboard" />

      <div className="max-w-lg mx-auto px-4 py-5">
        {/* Top 3 podium */}
        {leaderboard.length >= 3 && (
          <div className="mb-6">
            <div className="flex items-end justify-center gap-3">
              {/* 2nd */}
              <div className="flex flex-col items-center pb-2">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-black mb-2"
                  style={{ background: '#243B47', border: '3px solid #C0C0C0' }}>
                  {getLevel(leaderboard[1]?.xp || 0).level}
                </div>
                <div className="w-20 rounded-t-2xl pt-3 pb-2 text-center" style={{ background: '#1C2F39', border: '2px solid #2D4A58', height: 70 }}>
                  <Trophy size={18} style={{ color: '#C0C0C0', margin: '0 auto' }} />
                  <p className="text-xs font-black text-white mt-1 truncate px-1">{leaderboard[1]?.name?.split(' ')[0]}</p>
                </div>
              </div>
              {/* 1st */}
              <div className="flex flex-col items-center">
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-black mb-2"
                  style={{ background: 'rgba(255,215,0,0.15)', border: '3px solid #FFD700' }}>
                  {getLevel(leaderboard[0]?.xp || 0).level}
                </div>
                <div className="w-20 rounded-t-2xl pt-3 pb-2 text-center" style={{ background: 'rgba(255,215,0,0.12)', border: '2px solid rgba(255,215,0,0.5)', height: 90 }}>
                  <Trophy size={22} style={{ color: '#FFD700', margin: '0 auto' }} />
                  <p className="text-xs font-black text-white mt-1 truncate px-1">{leaderboard[0]?.name?.split(' ')[0]}</p>
                  <p className="text-xs" style={{ color: '#FFD700' }}>{leaderboard[0]?.xp} XP</p>
                </div>
              </div>
              {/* 3rd */}
              <div className="flex flex-col items-center pb-2">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-black mb-2"
                  style={{ background: '#243B47', border: '3px solid #CD7F32' }}>
                  {getLevel(leaderboard[2]?.xp || 0).level}
                </div>
                <div className="w-20 rounded-t-2xl pt-3 pb-2 text-center" style={{ background: '#1C2F39', border: '2px solid #2D4A58', height: 55 }}>
                  <Trophy size={16} style={{ color: '#CD7F32', margin: '0 auto' }} />
                  <p className="text-xs font-black text-white mt-1 truncate px-1">{leaderboard[2]?.name?.split(' ')[0]}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Full List */}
        <div className="c-card overflow-hidden">
          {leaderboard.length === 0 ? (
            <div className="p-10 text-center">
              <Trophy size={40} style={{ color: '#2D4A58', margin: '0 auto 12px' }} />
              <p className="font-black text-white">No rankings yet</p>
              <p className="text-xs mt-1" style={{ color: '#8DA8B5' }}>Be the first to complete lessons!</p>
            </div>
          ) : (
            leaderboard.map((user, i) => {
              const levelInfo = getLevel(user.xp || 0);
              const isMe = user.email === currentUserEmail;
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-3.5 transition-all"
                  style={{
                    borderBottom: i < leaderboard.length - 1 ? '1px solid #2D4A58' : 'none',
                    background: isMe ? 'rgba(28,176,246,0.08)' : 'transparent'
                  }}>
                  {/* Rank */}
                  <div className="w-7 text-center flex-shrink-0">
                    {i < 3 ? (
                      <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: `${medals[i]}20`, border: `2px solid ${medals[i]}` }}>
                        <span className="text-xs font-black" style={{ color: medals[i] }}>{i + 1}</span>
                      </div>
                    ) : (
                      <span className="text-xs font-bold" style={{ color: '#5C7A87' }}>#{i + 1}</span>
                    )}
                  </div>

                  {/* Level badge */}
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0"
                    style={{ background: isMe ? 'rgba(28,176,246,0.2)' : '#243B47', color: isMe ? '#1CB0F6' : '#8DA8B5', border: `2px solid ${isMe ? '#1CB0F6' : '#2D4A58'}` }}>
                    {levelInfo.level}
                  </div>

                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-black text-sm text-white truncate">{user.name}</p>
                      {isMe && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(28,176,246,0.2)', color: '#1CB0F6' }}>You</span>}
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: '#5C7A87' }}>{levelInfo.name}</p>
                  </div>

                  {/* Stats */}
                  <div className="flex flex-col items-end gap-0.5">
                    <div className="flex items-center gap-1">
                      <Zap size={12} style={{ color: '#FFD700' }} />
                      <span className="text-sm font-black" style={{ color: '#FFD700' }}>{user.xp || 0}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Flame size={11} style={{ color: '#FF9600' }} />
                      <span className="text-xs" style={{ color: '#8DA8B5' }}>{user.streak || 0}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
