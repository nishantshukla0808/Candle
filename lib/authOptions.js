import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './mongodb';

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        try {
          const db = await getDb();
          const user = await db.collection('users').findOne({ email: credentials.email.toLowerCase() });
          if (!user) return null;
          const isValid = await bcrypt.compare(credentials.password, user.password);
          if (!isValid) return null;
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.avatar || null,
          };
        } catch (err) {
          console.error('Auth error:', err);
          return null;
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'google') {
        try {
          const db = await getDb();
          const existing = await db.collection('users').findOne({ email: user.email.toLowerCase() });
          if (!existing) {
            const newUser = {
              id: uuidv4(),
              email: user.email.toLowerCase(),
              name: user.name || 'Adventurer',
              avatar: user.image || null,
              provider: 'google',
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
          }
        } catch (err) {
          console.error('Google signIn error:', err);
        }
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (user) {
        try {
          const db = await getDb();
          const dbUser = await db.collection('users').findOne({ email: user.email.toLowerCase() });
          if (dbUser) {
            token.userId = dbUser.id;
            token.xp = dbUser.xp;
            token.level = dbUser.level;
          }
        } catch (err) {
          console.error('JWT callback error:', err);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.userId;
        session.user.xp = token.xp || 0;
        session.user.level = token.level || 1;
      }
      return session;
    },
  },
  pages: {
    signIn: '/',
  },
  secret: process.env.NEXTAUTH_SECRET,
};
