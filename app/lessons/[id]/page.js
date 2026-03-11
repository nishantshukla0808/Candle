'use client';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Star, CheckCircle, XCircle, Zap, ChevronRight, BookOpen } from 'lucide-react';

// Confetti component
function Confetti() {
  const pieces = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    color: ['#58CC02', '#1CB0F6', '#FF9600', '#A560F5', '#FFD700'][i % 5],
    delay: `${Math.random() * 0.5}s`,
    size: Math.random() * 8 + 6,
  }));
  return (
    <div className="fixed inset-0 pointer-events-none z-50">
      {pieces.map(p => (
        <div key={p.id} className="confetti-piece" style={{
          left: p.left, top: '-20px', width: p.size, height: p.size,
          background: p.color, animationDelay: p.delay,
          borderRadius: Math.random() > 0.5 ? '50%' : '2px',
        }} />
      ))}
    </div>
  );
}

export default function LessonDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const lessonId = params?.id;

  const [lesson, setLesson] = useState(null);
  const [quiz, setQuiz] = useState(null);
  const [phase, setPhase] = useState('lesson');
  const [answers, setAnswers] = useState([]);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [xpGained, setXpGained] = useState(0);
  const [currentQ, setCurrentQ] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
    if (status === 'authenticated' && lessonId) fetchLesson();
  }, [status, lessonId]);

  const fetchLesson = async () => {
    try {
      const [lRes, qRes] = await Promise.all([
        fetch(`/api/lessons/${lessonId}`),
        fetch(`/api/quiz/${lessonId}`),
      ]);
      if (lRes.ok) setLesson(await lRes.json());
      if (qRes.ok) {
        const qData = await qRes.json();
        setQuiz(qData.quiz);
        setAnswers(new Array(qData.quiz.length).fill(null));
      }
    } catch (e) {}
    setLoading(false);
  };

  const completeLesson = async () => {
    try {
      const res = await fetch(`/api/lessons/${lessonId}/complete`, { method: 'POST' });
      const data = await res.json();
      setXpGained(p => p + (data.xpAwarded || 0));
    } catch (e) {}
  };

  const startQuiz = () => {
    completeLesson();
    setPhase('quiz');
    setCurrentQ(0);
    setSelectedAnswer(null);
  };

  const submitQuiz = async () => {
    if (answers.includes(null)) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/quiz/${lessonId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      const data = await res.json();
      setResults(data);
      setXpGained(p => p + (data.bonusXP || 0));
      setPhase('results');
      if (data.percentage >= 80) setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
    } catch (e) {}
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#131F24' }}>
        <div className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: '#1CB0F6', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (!lesson) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#131F24' }}>
        <div className="text-center">
          <XCircle size={48} style={{ color: '#FF4B4B', margin: '0 auto 16px' }} />
          <p className="text-white font-bold">Lesson not found</p>
          <Link href="/dashboard"><button className="btn-primary mt-4" style={{ maxWidth: 200 }}>Go Back</button></Link>
        </div>
      </div>
    );
  }

  // ===== RESULTS =====
  if (phase === 'results' && results) {
    const stars = results.percentage === 100 ? 3 : results.percentage >= 60 ? 2 : 1;
    return (
      <div className="min-h-screen flex flex-col" style={{ background: '#131F24' }}>
        {showConfetti && <Confetti />}

        <div className="flex-1 flex flex-col items-center justify-center px-5 py-8">
          {/* Score circle */}
          <div className="w-28 h-28 rounded-full flex flex-col items-center justify-center mb-4 bounce-in"
            style={{
              background: results.percentage >= 60 ? 'rgba(88,204,2,0.15)' : 'rgba(255,75,75,0.15)',
              border: `4px solid ${results.percentage >= 60 ? '#58CC02' : '#FF4B4B'}`,
            }}>
            <span className="text-3xl font-black text-white">{results.percentage}%</span>
            <span className="text-xs font-bold" style={{ color: '#8DA8B5' }}>{results.score}/{results.totalQuestions}</span>
          </div>

          {/* Stars */}
          <div className="flex gap-2 mb-2">
            {[1, 2, 3].map(i => (
              <Star key={i} size={32}
                fill={i <= stars ? '#FFD700' : 'none'}
                color={i <= stars ? '#FFD700' : '#2D4A58'}
                strokeWidth={2}
              />
            ))}
          </div>

          <h2 className="text-2xl font-black text-white mt-2">
            {results.percentage === 100 ? 'Perfect!' : results.percentage >= 60 ? 'Well done!' : 'Keep going!'}
          </h2>
          <p className="text-candle-muted text-sm mt-1">
            {results.percentage >= 60 ? 'You passed this lesson' : 'Review and try again'}
          </p>

          {/* XP earned */}
          <div className="flex items-center gap-2 mt-4 px-5 py-3 rounded-2xl"
            style={{ background: 'rgba(255,215,0,0.1)', border: '2px solid rgba(255,215,0,0.3)' }}>
            <Zap size={20} style={{ color: '#FFD700' }} />
            <span className="font-black text-white">+{xpGained} XP earned!</span>
          </div>

          {/* Question review */}
          <div className="w-full max-w-md mt-6 space-y-3">
            {results.results?.map((r, i) => (
              <div key={i} className="c-card p-3"
                style={{ borderColor: r.correct ? 'rgba(88,204,2,0.4)' : 'rgba(255,75,75,0.4)' }}>
                <div className="flex items-start gap-2">
                  {r.correct
                    ? <CheckCircle size={18} style={{ color: '#58CC02', flexShrink: 0, marginTop: 1 }} />
                    : <XCircle size={18} style={{ color: '#FF4B4B', flexShrink: 0, marginTop: 1 }} />}
                  <div>
                    <p className="text-xs font-bold text-white">{quiz?.[i]?.question}</p>
                    {!r.correct && (
                      <p className="text-xs mt-1" style={{ color: '#58CC02' }}>
                        Correct: {quiz?.[i]?.options?.[r.correctAnswer]}
                      </p>
                    )}
                    <p className="text-xs mt-1 italic" style={{ color: '#8DA8B5' }}>{r.explanation}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom actions */}
        <div className="p-5 space-y-3 max-w-md mx-auto w-full">
          <Link href="/dashboard">
            <button className="btn-primary">Continue Learning</button>
          </Link>
          {results.percentage < 60 && (
            <button onClick={() => { setPhase('quiz'); setCurrentQ(0); setAnswers(new Array(quiz.length).fill(null)); setSelectedAnswer(null); }}
              className="btn-secondary">
              Try Again
            </button>
          )}
        </div>
      </div>
    );
  }

  // ===== QUIZ =====
  if (phase === 'quiz' && quiz) {
    const q = quiz[currentQ];
    const isLast = currentQ === quiz.length - 1;

    return (
      <div className="min-h-screen flex flex-col" style={{ background: '#131F24' }}>
        {/* Progress bar */}
        <div className="sticky top-0 z-50" style={{ background: '#131F24', borderBottom: '2px solid #2D4A58' }}>
          <div className="h-1.5 w-full" style={{ background: '#1C2F39' }}>
            <div className="h-full transition-all duration-500" style={{
              width: `${((currentQ) / quiz.length) * 100}%`,
              background: '#58CC02'
            }} />
          </div>
          <div className="px-4 py-3 flex items-center gap-3">
            <button onClick={() => router.push(`/lessons/${lessonId}`)} className="text-candle-muted">
              <ArrowLeft size={22} />
            </button>
            <div className="flex-1 flex gap-1.5">
              {quiz.map((_, i) => (
                <div key={i} className="flex-1 h-2 rounded-full transition-all" style={{
                  background: i < currentQ ? '#58CC02' : i === currentQ ? '#1CB0F6' : '#2D4A58'
                }} />
              ))}
            </div>
            <span className="text-xs font-bold" style={{ color: '#8DA8B5' }}>{currentQ + 1}/{quiz.length}</span>
          </div>
        </div>

        <div className="flex-1 flex flex-col px-5 pt-6 pb-6 max-w-lg mx-auto w-full">
          {/* Question */}
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#8DA8B5' }}>Question {currentQ + 1}</p>
            <h2 className="text-lg font-black text-white leading-snug">{q.question}</h2>
          </div>

          {/* Options */}
          <div className="space-y-3 flex-1">
            {q.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => {
                  const newAnswers = [...answers];
                  newAnswers[currentQ] = i;
                  setAnswers(newAnswers);
                  setSelectedAnswer(i);
                }}
                className={`answer-option ${answers[currentQ] === i ? 'selected' : ''}`}
              >
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-black mr-3"
                  style={{
                    background: answers[currentQ] === i ? '#1CB0F6' : '#243B47',
                    color: 'white',
                    flexShrink: 0,
                  }}>
                  {String.fromCharCode(65 + i)}
                </span>
                {opt}
              </button>
            ))}
          </div>

          {/* Navigation */}
          <div className="mt-6 flex gap-3">
            {currentQ > 0 && (
              <button onClick={() => { setCurrentQ(p => p - 1); setSelectedAnswer(answers[currentQ - 1]); }}
                className="btn-secondary" style={{ width: 'auto', padding: '14px 20px' }}>
                <ArrowLeft size={18} />
              </button>
            )}
            {isLast ? (
              <button
                onClick={submitQuiz}
                disabled={answers.includes(null) || submitting}
                className="btn-primary flex-1"
              >
                {submitting ? 'Submitting...' : 'Submit'}
              </button>
            ) : (
              <button
                onClick={() => { setCurrentQ(p => p + 1); setSelectedAnswer(answers[currentQ + 1]); }}
                disabled={answers[currentQ] === null}
                className="btn-primary flex-1"
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ===== LESSON CONTENT =====
  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#131F24' }}>
      {/* Top bar */}
      <div className="sticky top-0 z-50 px-4 py-3 flex items-center gap-3" style={{ background: '#131F24', borderBottom: '2px solid #2D4A58' }}>
        <button onClick={() => router.push('/dashboard')} className="text-candle-muted">
          <ArrowLeft size={22} style={{ color: '#8DA8B5' }} />
        </button>
        <div className="flex-1">
          <div className="h-2 rounded-full" style={{ background: '#1C2F39' }}>
            <div className="h-full rounded-full" style={{ width: lesson.completed ? '100%' : '10%', background: '#58CC02', transition: 'width 1s ease' }} />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Zap size={15} style={{ color: '#FFD700' }} />
          <span className="text-xs font-black" style={{ color: '#FFD700' }}>+{lesson.xpReward} XP</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-5 py-5 max-w-lg mx-auto w-full">
        {/* Lesson header */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold px-2.5 py-1 rounded-full uppercase" style={{
              background: lesson.difficulty === 'beginner' ? 'rgba(88,204,2,0.15)' :
                lesson.difficulty === 'intermediate' ? 'rgba(28,176,246,0.15)' : 'rgba(165,96,245,0.15)',
              color: lesson.difficulty === 'beginner' ? '#58CC02' :
                lesson.difficulty === 'intermediate' ? '#1CB0F6' : '#A560F5'
            }}>{lesson.difficulty}</span>
            <span className="text-xs" style={{ color: '#5C7A87' }}>{lesson.duration}</span>
            {lesson.completed && <CheckCircle size={14} style={{ color: '#58CC02' }} />}
          </div>
          <h1 className="text-xl font-black text-white leading-tight">{lesson.title}</h1>
          <p className="text-sm mt-1" style={{ color: '#8DA8B5' }}>{lesson.subtitle}</p>
        </div>

        {/* Lesson body */}
        <div
          className="lesson-prose"
          dangerouslySetInnerHTML={{ __html: lesson.content }}
        />
      </div>

      {/* CTA */}
      <div className="p-5 max-w-lg mx-auto w-full">
        <button onClick={startQuiz} className="btn-primary">
          {lesson.completed ? 'Retake Quiz' : 'Take Quiz'}
        </button>
        <p className="text-center text-xs mt-2" style={{ color: '#5C7A87' }}>
          {quiz?.length || 5} questions • +{lesson.xpReward} XP on completion
        </p>
      </div>
    </div>
  );
}
