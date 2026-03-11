'use client';
import { useState, useEffect, useRef } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Home, Flame, Trophy, User, Zap, BookOpen, Star, Lock, CheckCircle, ChevronRight, Sparkles } from 'lucide-react';
import { getLevel, getNextLevel, getLevelProgress, MODULES } from '@/lib/lessonData';

// ---- Bottom Navigation ----
export function BottomNav() {
  const pathname = usePathname();
  const tabs = [
    { href: '/dashboard', icon: Home, label: 'Learn' },
    { href: '/daily', icon: Flame, label: 'Daily' },
    { href: '/leaderboard', icon: Trophy, label: 'Rank' },
    { href: '/profile', icon: User, label: 'Profile' },
  ];
  return (
    <nav className="bottom-nav">
      {tabs.map(({ href, icon: Icon, label }) => (
        <Link key={href} href={href} className={`bottom-nav-item ${pathname.startsWith(href) ? 'active' : ''}`}>
          <Icon size={22} strokeWidth={pathname.startsWith(href) ? 2.5 : 2} />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

// ---- Top Bar ----
export function TopBar({ xp = 0, streak = 0, title = '' }) {
  return (
    <div className="sticky top-0 z-50 px-4 py-3 flex items-center justify-between" style={{ background: '#131F24', borderBottom: '2px solid #2D4A58' }}>
      {title ? (
        <h2 className="text-base font-black text-white">{title}</h2>
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="text-lg font-black" style={{ color: '#FFD700' }}>CANDLE</span>
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Flame size={18} style={{ color: '#FF9600' }} />
          <span className="font-black text-sm" style={{ color: '#FF9600' }}>{streak}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Zap size={18} style={{ color: '#FFD700' }} />
          <span className="font-black text-sm" style={{ color: '#FFD700' }}>{xp.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

// ---- Lesson Node ----
function LessonNode({ lesson, index, completedLessons, isUnlocked }) {
  const isCompleted = completedLessons.includes(lesson.id);
  const isActive = isUnlocked && !isCompleted;
  const isRight = index % 2 === 0;

  let nodeStyle = {};
  let nodeClass = '';
  if (isCompleted) { nodeClass = 'node-complete'; }
  else if (isActive) { nodeClass = 'node-active'; }
  else { nodeClass = 'node-locked'; }

  const difficultyColor = {
    beginner: '#58CC02',
    intermediate: '#1CB0F6',
    advanced: '#A560F5',
  }[lesson.difficulty] || '#8DA8B5';

  return (
    <div className={`flex items-center ${isRight ? 'justify-start pl-6' : 'justify-end pr-6'}`}>
      <Link href={isUnlocked ? `/lessons/${lesson.id}` : '#'} className={isUnlocked ? '' : 'cursor-not-allowed'}>
        <div className="flex flex-col items-center gap-2">
          {/* Character bubble (only for active) */}
          {isActive && (
            <div className="px-3 py-1.5 rounded-xl text-xs font-bold text-white mb-1"
              style={{ background: '#1CB0F6', border: '2px solid #0E8ABF' }}>
              {lesson.duration} • +{lesson.xpReward} XP
            </div>
          )}

          <button
            className={`w-16 h-16 rounded-full border-4 flex items-center justify-center transition-all ${nodeClass}`}
            style={{ borderWidth: '4px' }}
            disabled={!isUnlocked}
          >
            {isCompleted ? (
              <CheckCircle size={28} color="white" strokeWidth={3} />
            ) : isActive ? (
              <BookOpen size={24} color="white" strokeWidth={2.5} />
            ) : (
              <Lock size={20} color="#5C7A87" strokeWidth={2} />
            )}
          </button>

          {/* Lesson name below node */}
          <p className={`text-xs font-bold text-center max-w-24 leading-tight ${
            isCompleted ? 'text-candle-green' : isActive ? 'text-white' : 'text-candle-faint'
          }`} style={isCompleted ? { color: '#58CC02' } : isActive ? { color: '#fff' } : { color: '#5C7A87' }}>
            {lesson.title.split(':')[0]}
          </p>
        </div>
      </Link>
    </div>
  );
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [lessonsData, setLessonsData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeModule, setActiveModule] = useState('module-1');

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
    if (status === 'authenticated') { fetchProfile(); fetchLessons(); }
  }, [status]);

  const fetchProfile = async () => {
    try {
      const res = await fetch('/api/user/profile');
      if (res.ok) setProfile((await res.json()).user);
    } catch (e) {}
    setLoading(false);
  };

  const fetchLessons = async () => {
    try {
      const res = await fetch('/api/lessons');
      if (res.ok) setLessonsData((await res.json()).lessons);
    } catch (e) {}
  };

  if (loading || status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#131F24' }}>
        <div className="text-center">
          <div className="w-16 h-16 rounded-full border-4 border-t-transparent mx-auto animate-spin" style={{ borderColor: '#1CB0F6', borderTopColor: 'transparent' }} />
          <p className="text-candle-muted mt-4 text-sm font-semibold">Loading your lessons...</p>
        </div>
      </div>
    );
  }

  const xp = profile?.xp || 0;
  const levelInfo = getLevel(xp);
  const nextLevel = getNextLevel(xp);
  const progress = getLevelProgress(xp);
  const streak = profile?.streak || 0;
  const completedLessons = profile?.completedLessons || [];

  const moduleData = MODULES.find(m => m.id === activeModule);
  const moduleLessons = lessonsData.filter(l => l.moduleId === activeModule);

  const isModuleUnlocked = (module) => {
    if (!module.requiredLessons) return true;
    return module.requiredLessons.every(l => completedLessons.includes(l));
  };

  const isLessonUnlocked = (index) => {
    if (!isModuleUnlocked(moduleData)) return false;
    if (index === 0) return true;
    return completedLessons.includes(moduleLessons[index - 1]?.id);
  };

  return (
    <div className="min-h-screen pb-24" style={{ background: '#131F24' }}>
      <TopBar xp={xp} streak={streak} />

      <div className="max-w-lg mx-auto px-4">
        {/* Level progress */}
        <div className="py-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-lg font-black"
                style={{ background: '#1CB0F6', color: 'white' }}>{levelInfo.level}</div>
              <div>
                <p className="text-xs font-bold text-white">{levelInfo.name}</p>
                <p className="text-xs" style={{ color: '#5C7A87' }}>{xp} XP</p>
              </div>
            </div>
            {nextLevel && (
              <p className="text-xs font-bold" style={{ color: '#5C7A87' }}>{nextLevel.minXP - xp} XP to Level {nextLevel.level}</p>
            )}
          </div>
          <div className="xp-track">
            <div className="xp-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Module selector */}
        <div className="flex gap-2 mb-5 overflow-x-auto pb-1 scrollbar-hide">
          {MODULES.map(module => {
            const unlocked = isModuleUnlocked(module);
            const active = activeModule === module.id;
            const doneCount = module.lessons.filter(l => completedLessons.includes(l)).length;
            return (
              <button
                key={module.id}
                onClick={() => unlocked && setActiveModule(module.id)}
                className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-xs font-bold transition-all border-2 ${
                  active ? 'text-white' : unlocked ? 'text-candle-muted' : 'text-candle-faint cursor-not-allowed'
                }`}
                style={{
                  background: active ? '#1CB0F6' : '#1C2F39',
                  borderColor: active ? '#0E8ABF' : '#2D4A58',
                }}
              >
                {!unlocked && <Lock size={10} className="inline mr-1" />}
                {module.title}
                <span className="ml-1.5 opacity-60">{doneCount}/{module.lessons.length}</span>
              </button>
            );
          })}
        </div>

        {/* Module banner */}
        {moduleData && (
          <div className="module-banner mb-6">
            <div className="relative z-10">
              <p className="text-xs font-bold text-white/60 uppercase tracking-wider">Module {MODULES.findIndex(m => m.id === activeModule) + 1}</p>
              <h2 className="text-lg font-black text-white mt-0.5">{moduleData.title}</h2>
              <p className="text-sm text-white/70 mt-0.5">{moduleData.subtitle}</p>
              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1 h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.2)' }}>
                  <div className="h-full rounded-full" style={{
                    width: `${(moduleData.lessons.filter(l => completedLessons.includes(l)).length / moduleData.lessons.length) * 100}%`,
                    background: 'white'
                  }} />
                </div>
                <span className="text-xs font-bold text-white">
                  {moduleData.lessons.filter(l => completedLessons.includes(l)).length}/{moduleData.lessons.length}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Lesson path - Duolingo style */}
        <div className="relative">
          {moduleLessons.map((lesson, i) => {
            const unlocked = isLessonUnlocked(i);
            const completed = completedLessons.includes(lesson.id);
            const isRight = i % 2 !== 0;

            return (
              <div key={lesson.id}>
                {/* Path segment */}
                {i > 0 && (
                  <div className={`h-10 w-1 mx-auto rounded-full ${completed ? 'path-line-complete' : 'path-line'}`} />
                )}

                <div className={`flex items-center gap-3 ${isRight ? 'flex-row-reverse' : ''}`}>
                  {/* Node */}
                  <Link
                    href={unlocked ? `/lessons/${lesson.id}` : '#'}
                    className={`flex-shrink-0 ${!unlocked ? 'cursor-not-allowed' : ''}`}
                  >
                    <div className="flex flex-col items-center gap-2">
                      {/* Speech bubble for active */}
                      {unlocked && !completed && (
                        <div className="px-2.5 py-1 rounded-lg text-xs font-black text-white mb-1"
                          style={{ background: '#1CB0F6', borderRadius: '8px 8px 8px 2px' }}>
                          START
                        </div>
                      )}
                      <div
                        className={`w-16 h-16 rounded-full flex items-center justify-center transition-transform active:scale-95 ${completed ? 'node-complete' : unlocked ? 'node-active' : 'node-locked'}`}
                        style={{ border: '4px solid', borderColor: completed ? '#46A302' : unlocked ? '#0E8ABF' : '#2D4A58' }}
                      >
                        {completed ? (
                          <CheckCircle size={28} color="white" strokeWidth={3} />
                        ) : unlocked ? (
                          <Star size={24} color="white" strokeWidth={2.5} />
                        ) : (
                          <Lock size={20} color="#5C7A87" strokeWidth={2} />
                        )}
                      </div>
                    </div>
                  </Link>

                  {/* Info card */}
                  <Link href={unlocked ? `/lessons/${lesson.id}` : '#'} className={`flex-1 ${!unlocked ? 'cursor-not-allowed' : ''}`}>
                    <div className={`c-card p-3 transition-all ${
                      completed ? 'border-candle-green/40' :
                      unlocked ? 'border-candle-blue/40' : 'opacity-50'
                    }`} style={{
                      borderColor: completed ? 'rgba(88,204,2,0.3)' :
                        unlocked ? 'rgba(28,176,246,0.3)' : '#2D4A58'
                    }}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-black text-white leading-tight">{lesson.title}</p>
                          <p className="text-xs mt-0.5" style={{ color: '#8DA8B5' }}>{lesson.subtitle}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{
                              background: lesson.difficulty === 'beginner' ? 'rgba(88,204,2,0.15)' :
                                lesson.difficulty === 'intermediate' ? 'rgba(28,176,246,0.15)' : 'rgba(165,96,245,0.15)',
                              color: lesson.difficulty === 'beginner' ? '#58CC02' :
                                lesson.difficulty === 'intermediate' ? '#1CB0F6' : '#A560F5'
                            }}>
                              {lesson.difficulty}
                            </span>
                            <span className="text-xs font-bold" style={{ color: '#FFD700' }}>+{lesson.xpReward} XP</span>
                            <span className="text-xs" style={{ color: '#5C7A87' }}>{lesson.duration}</span>
                          </div>
                        </div>
                        {unlocked && (
                          <ChevronRight size={16} style={{ color: completed ? '#58CC02' : '#1CB0F6', flexShrink: 0, marginLeft: 8 }} />
                        )}
                      </div>
                    </div>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        {/* Completion message */}
        {moduleLessons.every(l => completedLessons.includes(l.id)) && moduleLessons.length > 0 && (
          <div className="mt-6 p-4 rounded-2xl text-center" style={{ background: 'rgba(88,204,2,0.1)', border: '2px solid rgba(88,204,2,0.3)' }}>
            <CheckCircle size={32} style={{ color: '#58CC02', margin: '0 auto 8px' }} />
            <p className="font-black text-white">Module Complete!</p>
            <p className="text-xs mt-1" style={{ color: '#8DA8B5' }}>Select the next module above to continue</p>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
