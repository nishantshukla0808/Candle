'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Lessons are now part of the dashboard path view
export default function LessonsPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard'); }, []);
  return null;
}

export default function LessonsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [lessonsData, setLessonsData] = useState([]);
  const [modulesData, setModulesData] = useState(MODULES);
  const [completedLessons, setCompletedLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeModule, setActiveModule] = useState('module-1');

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
    if (status === 'authenticated') fetchLessons();
  }, [status]);

  const fetchLessons = async () => {
    try {
      const res = await fetch('/api/lessons');
      if (res.ok) {
        const data = await res.json();
        setLessonsData(data.lessons);
        const done = data.lessons.filter(l => l.completed).map(l => l.id);
        setCompletedLessons(done);
      }
    } catch (e) {}
    setLoading(false);
  };

  const isModuleUnlocked = (module) => {
    if (!module.requiredLessons) return true;
    return module.requiredLessons.every(l => completedLessons.includes(l));
  };

  const activeModuleData = modulesData.find(m => m.id === activeModule);
  const moduleLessons = lessonsData.filter(l => l.moduleId === activeModule);
  const moduleUnlocked = activeModuleData ? isModuleUnlocked(activeModuleData) : false;

  const difficultyColor = { beginner: 'text-emerald-400', intermediate: 'text-amber-400', advanced: 'text-red-400' };
  const difficultyBg = { beginner: 'bg-emerald-900/30 border-emerald-500/30', intermediate: 'bg-amber-900/30 border-amber-500/30', advanced: 'bg-red-900/30 border-red-500/30' };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0f0a1e 0%, #1a0f2e 100%)' }}>
        <div className="text-6xl animate-bounce">📚</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0f0a1e 0%, #1a0f2e 100%)' }}>
      <div className="stars-bg" />

      {/* Navbar */}
      <nav className="relative z-10 border-b" style={{ borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(15,10,30,0.8)', backdropFilter: 'blur(10px)' }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="text-2xl">🕯️</span>
            <span className="text-xl font-black text-gold-DEFAULT" style={{ fontFamily: 'Cinzel, serif', color: '#ffd700' }}>CANDLE</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-parchment-muted hover:text-fire-DEFAULT transition-colors text-sm">Dashboard</Link>
            <Link href="/leaderboard" className="text-parchment-muted hover:text-fire-DEFAULT transition-colors text-sm">Leaderboard</Link>
          </div>
        </div>
      </nav>

      <div className="relative z-10 max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-black mb-2" style={{ fontFamily: 'Cinzel, serif', color: '#ffd700' }}>🗺️ The Adventure Map</h1>
          <p className="text-parchment-muted">Choose your quest path and conquer each module!</p>
        </div>

        {/* Module Tabs */}
        <div className="flex gap-3 mb-8 overflow-x-auto pb-2">
          {modulesData.map(module => {
            const unlocked = isModuleUnlocked(module);
            const moduleCompleted = module.lessons.every(l => completedLessons.includes(l));
            const active = activeModule === module.id;
            return (
              <button
                key={module.id}
                onClick={() => setActiveModule(module.id)}
                className={`flex-shrink-0 flex items-center gap-2 px-5 py-3 rounded-xl transition-all border ${
                  active
                    ? 'border-fire-DEFAULT text-parchment-DEFAULT'
                    : 'border-dungeon-border text-parchment-muted hover:border-parchment-muted/30'
                } ${!unlocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                style={active ? { background: 'rgba(255,107,53,0.15)' } : { background: 'rgba(255,255,255,0.03)' }}
                disabled={!unlocked}
              >
                <span className="text-xl">{module.character}</span>
                <div className="text-left">
                  <div className="text-sm font-semibold" style={{ fontFamily: 'Cinzel, serif' }}>{module.title}</div>
                  <div className="text-xs text-parchment-muted">
                    {!unlocked ? '🔒 Locked' : moduleCompleted ? '✅ Complete' : `${module.lessons.filter(l => completedLessons.includes(l)).length}/${module.lessons.length} done`}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Lessons Grid */}
        {activeModuleData && (
          <div>
            <div className="adventure-card p-5 mb-6">
              <div className="flex items-center gap-4">
                <div className="text-5xl">{activeModuleData.character}</div>
                <div>
                  <h2 className="text-xl font-bold" style={{ fontFamily: 'Cinzel, serif', color: '#ffd700' }}>{activeModuleData.title}</h2>
                  <p className="text-parchment-muted text-sm">{activeModuleData.subtitle}</p>
                  {!moduleUnlocked && (
                    <p className="text-red-400 text-sm mt-1">🔒 Complete the previous module to unlock this!</p>
                  )}
                </div>
              </div>
            </div>

            {/* Lesson Path - Map Style */}
            <div className="relative">
              {/* Connecting line */}
              <div className="absolute left-1/2 top-0 bottom-0 w-0.5 -translate-x-1/2" style={{ background: 'rgba(255,107,53,0.2)' }} />

              <div className="space-y-4">
                {moduleLessons.map((lesson, i) => {
                  const isCompleted = completedLessons.includes(lesson.id);
                  const prevCompleted = i === 0 || completedLessons.includes(moduleLessons[i - 1]?.id);
                  const isUnlocked = moduleUnlocked && prevCompleted;
                  const isEven = i % 2 === 0;

                  return (
                    <div key={lesson.id} className={`relative flex ${isEven ? 'justify-start' : 'justify-end'}`}>
                      {/* Node on path */}
                      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 z-10"
                        style={{
                          background: isCompleted ? '#22c55e' : isUnlocked ? '#ff6b35' : '#1e1535',
                          borderColor: isCompleted ? '#22c55e' : isUnlocked ? '#ff6b35' : '#2d1f5e'
                        }}
                      />

                      <div className={`w-5/12 ${!isUnlocked ? 'opacity-50' : ''}`}>
                        {isUnlocked ? (
                          <Link href={`/lessons/${lesson.id}`}>
                            <div className={`adventure-card p-4 transition-all hover:scale-105 hover:shadow-lg cursor-pointer border ${
                              isCompleted ? 'border-emerald-500/40' : 'border-fire-DEFAULT/30 hover:border-fire-DEFAULT'
                            }`}
                              style={isCompleted ? { background: 'rgba(34,197,94,0.05)' } : {}}
                            >
                              <div className="flex items-start gap-3">
                                <div className="text-3xl">{lesson.character}</div>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    {isCompleted && <span className="text-emerald-400 text-sm">✅</span>}
                                    <h3 className="font-bold text-parchment-DEFAULT text-sm" style={{ fontFamily: 'Cinzel, serif' }}>{lesson.title}</h3>
                                  </div>
                                  <p className="text-parchment-muted text-xs mb-2">{lesson.subtitle}</p>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className={`text-xs px-2 py-0.5 rounded-full border ${difficultyBg[lesson.difficulty] || ''} ${difficultyColor[lesson.difficulty] || ''}`}>
                                      {lesson.difficulty}
                                    </span>
                                    <span className="text-xs text-amber-400">⚡ +{lesson.xpReward} XP</span>
                                    <span className="text-xs text-parchment-muted">⏱ {lesson.duration}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </Link>
                        ) : (
                          <div className="adventure-card p-4 cursor-not-allowed border border-dungeon-border">
                            <div className="flex items-start gap-3">
                              <div className="text-3xl opacity-50">🔒</div>
                              <div>
                                <h3 className="font-bold text-parchment-muted text-sm" style={{ fontFamily: 'Cinzel, serif' }}>{lesson.title}</h3>
                                <p className="text-parchment-muted/50 text-xs mt-1">Complete previous quest to unlock</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
