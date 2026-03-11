'use client';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Star, CheckCircle, XCircle, Zap, ChevronRight, ChevronLeft, BookOpen, Heart } from 'lucide-react';
import CandleLogo from '@/components/CandleLogo';
import AuthModal from '@/components/AuthModal';

// Parse HTML content into slides based on h2/h3 tags or sections
function parseContentToSlides(html) {
  if (!html) return [];
  // Simple approach: split by h2 or h3 tags
  const parts = html.split(/(<h[23]>.*?<\/h[23]>)/gi);
  const slides = [];
  let currentSlide = '';
  for (const part of parts) {
    if (part.match(/<h[23]>/i)) {
      if (currentSlide.trim()) slides.push(currentSlide.trim());
      currentSlide = part;
    } else {
      currentSlide += part;
    }
  }
  if (currentSlide.trim()) slides.push(currentSlide.trim());
  return slides.length > 0 ? slides : [html];
}

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
  
  // New states for slides and hearts
  const [slides, setSlides] = useState([]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [hearts, setHearts] = useState(5);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const isGuest = status !== 'authenticated';

  useEffect(() => {
    if (lessonId) fetchLesson();
  }, [status, lessonId]);

  const fetchLesson = async () => {
    try {
      const promises = [
        fetch(`/api/lessons/${lessonId}`),
        fetch(`/api/quiz/${lessonId}`),
      ];
      if (!isGuest) {
        promises.push(fetch('/api/user/hearts'));
      }
      const responses = await Promise.all(promises);
      
      if (responses[0].ok) {
        const lessonData = await responses[0].json();
        setLesson(lessonData);
        // Parse content into slides
        const parsedSlides = parseContentToSlides(lessonData.content);
        setSlides(parsedSlides);
      }
      if (responses[1].ok) {
        const qData = await responses[1].json();
        setQuiz(qData.quiz);
        setAnswers(new Array(qData.quiz.length).fill(null));
      }
      if (responses[2] && responses[2].ok) {
        const heartsData = await responses[2].json();
        setHearts(heartsData.hearts ?? 5);
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
    if (isGuest) {
      setShowAuthModal(true);
      return;
    }
    if (hearts <= 0) {
      alert('You need at least 1 heart to take a quiz. Hearts refill daily!');
      return;
    }
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

  // ===== LESSON CONTENT WITH SLIDES =====
  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#1a2f3e' }}>
      {/* Top bar with progress */}
      <div className="sticky top-0 z-50" style={{ background: '#1a2f3e' }}>
        {/* Green progress bar */}
        <div className="h-1.5 w-full" style={{ background: '#2d4a58' }}>
          <div className="h-full transition-all duration-500" style={{
            width: `${((currentSlide + 1) / slides.length) * 100}%`,
            background: '#58CC02'
          }} />
        </div>
        
        {/* Top navigation bar */}
        <div className="px-4 py-3 flex items-center justify-between">
          <button onClick={() => router.push('/dashboard')} className="text-white hover:opacity-75 transition-opacity">
            <ArrowLeft size={22} />
          </button>
          
          <span className="text-sm font-bold text-white">
            {currentSlide + 1}/{slides.length}
          </span>
          
          <div className="flex items-center gap-2">
            {!isGuest && (
              <div className="flex items-center gap-1.5">
                <Heart size={16} fill={hearts > 0 ? '#ef4444' : 'none'} color="#ef4444" />
                <span className="text-sm font-bold text-red-400">{hearts}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <Zap size={15} style={{ color: '#FFD700' }} />
              <span className="text-sm font-black" style={{ color: '#FFD700' }}>+{lesson.xpReward}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Hearts warning */}
      {!isGuest && hearts <= 2 && hearts > 0 && (
        <div className="px-4 py-2 text-center text-sm" style={{ background: 'rgba(255,165,0,0.15)', color: '#ffa500' }}>
          ⚠️ Low on hearts! Be careful with quiz answers.
        </div>
      )}
      {!isGuest && hearts === 0 && (
        <div className="px-4 py-2 text-center text-sm" style={{ background: 'rgba(255,75,75,0.15)', color: '#ff4b4b' }}>
          ❤️‍🩹 No hearts left! Hearts refill daily. You can still read lessons.
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col px-5 py-6 max-w-3xl mx-auto w-full">
        {/* Lesson header - centered */}
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="text-xs font-bold px-3 py-1 rounded-full uppercase" style={{
              background: lesson.difficulty === 'beginner' ? '#58CC02' : 
                lesson.difficulty === 'intermediate' ? '#FF9600' : '#ef4444',
              color: 'white'
            }}>{lesson.difficulty}</span>
            <div className="flex items-center gap-1 text-sm" style={{ color: '#5C7A87' }}>
              <span>{lesson.duration}</span>
              {lesson.completed && <CheckCircle size={14} style={{ color: '#58CC02' }} />}
            </div>
          </div>
          <h1 className="text-2xl font-black text-white leading-tight mb-2">
            {lesson.title}
          </h1>
          <p className="text-sm" style={{ color: '#7FA4B8' }}>{lesson.subtitle}</p>
        </div>

        {/* Slide indicator dots */}
        <div className="flex items-center justify-center gap-1.5 mb-4">
          {slides.map((_, i) => (
            <div key={i} className="rounded-full transition-all duration-300" style={{
              width: '10px',
              height: '10px',
              background: i === currentSlide ? '#58CC02' : 
                i < currentSlide ? '#58CC02' : 'rgba(255,255,255,0.2)'
            }} />
          ))}
        </div>

        {/* Current slide card */}
        <div className="flex-1 mb-6">
          <div className="rounded-2xl p-8 min-h-[300px]" style={{ 
            background: '#213d4f',
            border: '1px solid #2d4a58'
          }}>
            <div
              className="lesson-prose"
              dangerouslySetInnerHTML={{ __html: slides[currentSlide] || '' }}
            />
          </div>
        </div>

        {/* Single Continue/Take Quiz button */}
        <div className="mt-auto">
          {currentSlide < slides.length - 1 ? (
            <button
              onClick={() => setCurrentSlide(p => p + 1)}
              className="w-full py-4 rounded-xl text-base font-black uppercase tracking-wider transition-all"
              style={{
                background: '#58CC02',
                color: 'white',
                border: 'none',
                boxShadow: '0 4px 0 #469902'
              }}
            >
              CONTINUE <ChevronRight size={20} style={{ display: 'inline', marginLeft: '4px' }} />
            </button>
          ) : (
            <button
              onClick={startQuiz}
              className="w-full py-4 rounded-xl text-base font-black uppercase tracking-wider transition-all"
              style={{
                background: '#58CC02',
                color: 'white',
                border: 'none',
                boxShadow: '0 4px 0 #469902'
              }}
            >
              <Zap size={20} style={{ display: 'inline', marginRight: '8px' }} />
              {lesson.completed ? 'RETAKE QUIZ' : 'TAKE QUIZ'}
            </button>
          )}
          
          <p className="text-center text-xs mt-3" style={{ color: '#5C7A87' }}>
            {quiz?.length || 5} questions • +{lesson.xpReward} XP on completion
          </p>
        </div>
      </div>

      {/* Auth Modal */}
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          message="Sign in to take quizzes and track your progress!"
        />
      )}
    </div>
  );
}
