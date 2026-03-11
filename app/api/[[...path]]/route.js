import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';
import { getDb } from '@/lib/mongodb';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { LESSONS, MODULES, BADGES } from '@/lib/lessonData';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Helper: Get authenticated user from session
async function getAuthUser(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return null;
    const db = await getDb();
    const user = await db.collection('users').findOne({ email: session.user.email.toLowerCase() });
    return user;
  } catch (err) {
    console.error('getAuthUser error:', err);
    return null;
  }
}

// Helper: Check and update streak
async function updateStreak(db, userId) {
  const user = await db.collection('users').findOne({ id: userId });
  if (!user) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  const lastActive = user.lastActiveDate ? new Date(user.lastActiveDate) : null;
  if (lastActive) lastActive.setHours(0, 0, 0, 0);

  const lastActiveStr = lastActive ? lastActive.toISOString().split('T')[0] : null;

  if (lastActiveStr === todayStr) return; // Already active today

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  let newStreak = lastActiveStr === yesterdayStr ? (user.streak || 0) + 1 : 1;

  await db.collection('users').updateOne(
    { id: userId },
    { $set: { streak: newStreak, lastActiveDate: new Date() } }
  );
}

// Helper: Award badges
async function checkAndAwardBadges(db, user) {
  const earnedBadges = [...(user.badges || [])];
  const newBadges = [];

  const completedCount = (user.completedLessons || []).length;

  // First Quest
  if (completedCount >= 1 && !earnedBadges.includes('first-quest')) {
    earnedBadges.push('first-quest');
    newBadges.push('first-quest');
  }
  // Market Apprentice - all module 1
  const module1Lessons = ['lesson-1', 'lesson-2', 'lesson-3', 'lesson-4', 'lesson-5'];
  if (module1Lessons.every(l => (user.completedLessons || []).includes(l)) && !earnedBadges.includes('market-apprentice')) {
    earnedBadges.push('market-apprentice');
    newBadges.push('market-apprentice');
  }
  // Streak Warrior
  if ((user.streak || 0) >= 3 && !earnedBadges.includes('streak-warrior')) {
    earnedBadges.push('streak-warrior');
    newBadges.push('streak-warrior');
  }
  // Knowledge Seeker - level 3
  if ((user.xp || 0) >= 1250 && !earnedBadges.includes('knowledge-seeker')) {
    earnedBadges.push('knowledge-seeker');
    newBadges.push('knowledge-seeker');
  }
  // Fundamental Sage - all module 2
  const module2Lessons = ['lesson-6', 'lesson-7', 'lesson-8', 'lesson-9', 'lesson-10'];
  if (module2Lessons.every(l => (user.completedLessons || []).includes(l)) && !earnedBadges.includes('fundamental-sage')) {
    earnedBadges.push('fundamental-sage');
    newBadges.push('fundamental-sage');
  }

  if (newBadges.length > 0) {
    await db.collection('users').updateOne(
      { id: user.id },
      { $set: { badges: earnedBadges } }
    );
  }

  return newBadges;
}

export async function GET(request, { params }) {
  const path = params?.path || [];
  const route = path.join('/');

  try {
    // GET /api/lessons
    if (route === 'lessons') {
      const user = await getAuthUser(request);
      const completedLessons = user?.completedLessons || [];
      const lessonsWithStatus = Object.values(LESSONS).map(lesson => ({
        id: lesson.id,
        moduleId: lesson.moduleId,
        title: lesson.title,
        subtitle: lesson.subtitle,
        character: lesson.character,
        characterName: lesson.characterName,
        difficulty: lesson.difficulty,
        xpReward: lesson.xpReward,
        duration: lesson.duration,
        completed: completedLessons.includes(lesson.id),
      }));
      return NextResponse.json({ lessons: lessonsWithStatus, modules: MODULES });
    }

    // GET /api/lessons/:id
    if (path.length === 2 && path[0] === 'lessons') {
      const lessonId = path[1];
      const lesson = LESSONS[lessonId];
      if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
      const user = await getAuthUser(request);
      const completed = user?.completedLessons?.includes(lessonId) || false;
      return NextResponse.json({ ...lesson, completed });
    }

    // GET /api/quiz/:lessonId
    if (path.length === 2 && path[0] === 'quiz') {
      const lessonId = path[1];
      const lesson = LESSONS[lessonId];
      if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
      // Return quiz without correct answers
      const quizWithoutAnswers = lesson.quiz.map(q => ({
        id: q.id,
        question: q.question,
        options: q.options,
      }));
      return NextResponse.json({ quiz: quizWithoutAnswers, lessonId, lessonTitle: lesson.title });
    }

    // GET /api/leaderboard
    if (route === 'leaderboard') {
      const db = await getDb();
      const users = await db.collection('users')
        .find({}, { projection: { name: 1, xp: 1, level: 1, streak: 1, badges: 1, completedLessons: 1 } })
        .sort({ xp: -1 })
        .limit(50)
        .toArray();
      return NextResponse.json({ leaderboard: users });
    }

    // GET /api/user/profile
    if (route === 'user/profile') {
      const user = await getAuthUser(request);
      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      const { password, _id, ...safeUser } = user;
      return NextResponse.json({ user: safeUser });
    }

    // GET /api/daily-challenge
    if (route === 'daily-challenge') {
      const user = await getAuthUser(request);
      const today = new Date().toISOString().split('T')[0];
      const lessonKeys = Object.keys(LESSONS);
      // Pick a lesson based on day of year
      const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
      const challengeLesson = lessonKeys[dayOfYear % lessonKeys.length];
      const lesson = LESSONS[challengeLesson];
      const completed = user?.dailyChallengeCompleted === today;
      return NextResponse.json({
        challenge: {
          id: challengeLesson,
          title: lesson.title,
          character: lesson.character,
          xpReward: 75,
          question: lesson.quiz[0].question,
          options: lesson.quiz[0].options,
          date: today,
          completed,
        }
      });
    }

    return NextResponse.json({ error: 'Route not found' }, { status: 404 });
  } catch (err) {
    console.error('GET error:', err);
    return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  const path = params?.path || [];
  const route = path.join('/');

  try {
    // POST /api/register
    if (route === 'register') {
      const { name, email, password } = await request.json();
      if (!name || !email || !password) {
        return NextResponse.json({ error: 'All fields required' }, { status: 400 });
      }
      const db = await getDb();
      const existing = await db.collection('users').findOne({ email: email.toLowerCase() });
      if (existing) {
        return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
      }
      const hashedPassword = await bcrypt.hash(password, 12);
      const newUser = {
        id: uuidv4(),
        email: email.toLowerCase(),
        name,
        password: hashedPassword,
        provider: 'credentials',
        xp: 0,
        level: 1,
        streak: 0,
        lastActiveDate: null,
        badges: [],
        completedLessons: [],
        completedQuizzes: [],
        dailyChallengeCompleted: null,
        createdAt: new Date(),
      };
      await db.collection('users').insertOne(newUser);
      return NextResponse.json({ message: 'Account created! Start your adventure!', userId: newUser.id }, { status: 201 });
    }

    // POST /api/lessons/:id/complete
    if (path.length === 3 && path[0] === 'lessons' && path[2] === 'complete') {
      const lessonId = path[1];
      const user = await getAuthUser(request);
      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const lesson = LESSONS[lessonId];
      if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });

      const db = await getDb();
      await updateStreak(db, user.id);

      // Check if already completed
      if ((user.completedLessons || []).includes(lessonId)) {
        return NextResponse.json({ message: 'Already completed', xpAwarded: 0 });
      }

      const xpAwarded = lesson.xpReward;
      const newXp = (user.xp || 0) + xpAwarded;
      const newLevel = Math.floor(newXp / 500) + 1;

      await db.collection('users').updateOne(
        { id: user.id },
        {
          $set: { xp: newXp, level: newLevel },
          $addToSet: { completedLessons: lessonId }
        }
      );

      const updatedUser = await db.collection('users').findOne({ id: user.id });
      const newBadges = await checkAndAwardBadges(db, updatedUser);

      return NextResponse.json({ message: 'Lesson completed!', xpAwarded, newXp, newLevel, newBadges });
    }

    // POST /api/quiz/:lessonId/submit
    if (path.length === 3 && path[0] === 'quiz' && path[2] === 'submit') {
      const lessonId = path[1];
      const user = await getAuthUser(request);
      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const lesson = LESSONS[lessonId];
      if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });

      const { answers } = await request.json();
      const results = lesson.quiz.map((q, i) => ({
        questionId: q.id,
        correct: answers[i] === q.correct,
        correctAnswer: q.correct,
        explanation: q.explanation,
        userAnswer: answers[i],
      }));

      const score = results.filter(r => r.correct).length;
      const totalQuestions = lesson.quiz.length;
      const percentage = Math.round((score / totalQuestions) * 100);

      // Award bonus XP for quiz
      const bonusXP = Math.round((score / totalQuestions) * lesson.xpReward * 0.5);

      const db = await getDb();
      const newXp = (user.xp || 0) + bonusXP;
      const newLevel = Math.floor(newXp / 500) + 1;

      const quizRecord = {
        lessonId,
        score: percentage,
        completedAt: new Date(),
      };

      await db.collection('users').updateOne(
        { id: user.id },
        {
          $set: { xp: newXp, level: newLevel },
          $push: { completedQuizzes: quizRecord }
        }
      );

      // Award Quiz Master badge for 100%
      if (percentage === 100) {
        const updatedUser = await db.collection('users').findOne({ id: user.id });
        if (!(updatedUser.badges || []).includes('quiz-master')) {
          await db.collection('users').updateOne(
            { id: user.id },
            { $addToSet: { badges: 'quiz-master' } }
          );
        }
      }

      return NextResponse.json({ results, score, totalQuestions, percentage, bonusXP, newXp });
    }

    // POST /api/daily-challenge/complete
    if (route === 'daily-challenge/complete') {
      const user = await getAuthUser(request);
      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const today = new Date().toISOString().split('T')[0];
      if (user.dailyChallengeCompleted === today) {
        return NextResponse.json({ message: 'Already completed today', xpAwarded: 0 });
      }

      const db = await getDb();
      const xpAwarded = 75;
      const newXp = (user.xp || 0) + xpAwarded;
      const newLevel = Math.floor(newXp / 500) + 1;
      await db.collection('users').updateOne(
        { id: user.id },
        { $set: { dailyChallengeCompleted: today, xp: newXp, level: newLevel } }
      );

      return NextResponse.json({ message: 'Daily challenge complete! +75 XP', xpAwarded });
    }

    // POST /api/ai/suggest
    if (route === 'ai/suggest') {
      const user = await getAuthUser(request);
      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const { weakAreas, recentScores } = await request.json();

      const completedLessons = user.completedLessons || [];
      const completedQuizzes = user.completedQuizzes || [];

      // Find weak areas based on quiz scores
      const lowScoreQuizzes = completedQuizzes.filter(q => q.score < 70);
      const weakLessonIds = lowScoreQuizzes.map(q => q.lessonId);
      const weakLessonTitles = weakLessonIds.map(id => LESSONS[id]?.title).filter(Boolean);

      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

      const prompt = `You are Seraphina, a wise witch and financial advisor in a fantasy stock market learning game called Candle.

Student Profile:
- Completed lessons: ${completedLessons.length} out of ${Object.keys(LESSONS).length}
- Current XP: ${user.xp}
- Weak areas (scored below 70%): ${weakLessonTitles.length > 0 ? weakLessonTitles.join(', ') : 'None identified yet'}
- Streak: ${user.streak} days

Available lessons they haven't completed yet:
${Object.values(LESSONS).filter(l => !completedLessons.includes(l.id)).map(l => `- ${l.title} (${l.difficulty})`).join('\n')}

Give a SHORT personalized learning recommendation in 2-3 sentences. Use fantasy/adventure language. Mention specific lesson names. Be encouraging and specific about what they should focus on next and WHY. Keep it under 80 words.`;

      const result = await model.generateContent(prompt);
      const suggestion = result.response.text();

      return NextResponse.json({ suggestion });
    }

    return NextResponse.json({ error: 'Route not found' }, { status: 404 });
  } catch (err) {
    console.error('POST error:', err);
    return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
  }
}
