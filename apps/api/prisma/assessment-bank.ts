// Candle onboarding assessment question bank (v1).
// Content only — this file defines seed data, no logic lives here.
// Rules enforced by convention: SINGLE questions have exactly one correct
// option; MULTI questions have two or more correct; never "all of the above"
// as an option. Explanations are admin-only and NEVER served to clients.
// All content is original, written for beginners in simple English, with
// fictional numbers in rupees. No real companies, tickers, or advice.

export type AssessmentTopicKey = 'money-basics' | 'banking-saving' | 'markets' | 'investor-mindset';

export type AssessmentQuestionKind = 'SINGLE' | 'MULTI';

export interface AssessmentSeedOption {
  text: string;
  isCorrect: boolean;
}

export interface AssessmentSeedQuestion {
  topicKey: AssessmentTopicKey;
  difficulty: 1 | 2 | 3; // 1 = recall, 2 = applied, 3 = judgment
  kind: AssessmentQuestionKind;
  text: string;
  explanation: string; // admin-only, NEVER served to clients; 1-2 sentences teaching the concept
  options: AssessmentSeedOption[]; // exactly 4 options
}

export const ASSESSMENT_BANK_V1: AssessmentSeedQuestion[] = [
  {
    topicKey: 'money-basics',
    difficulty: 1,
    kind: 'SINGLE',
    text: 'Inflation is 6% a year. What happens to ₹1,00,000 kept as cash for a year?',
    explanation: 'Purchasing power falls as prices rise; cash sitting idle does not keep up.',
    options: [
      { text: 'It stays worth the same', isCorrect: false },
      { text: 'It can buy about 6% less', isCorrect: true },
      { text: 'It grows by 6%', isCorrect: false },
      { text: 'It becomes worthless', isCorrect: false },
    ],
  },
  {
    topicKey: 'money-basics',
    difficulty: 2,
    kind: 'SINGLE',
    text: 'Your savings account pays 3% interest, but inflation is 5%. After a year, your money...',
    explanation:
      'Interest adds 3% while prices rise 5%, so your money buys about 2% less than before.',
    options: [
      { text: 'Buys about the same as before', isCorrect: false },
      { text: 'Buys about 2% less than before', isCorrect: true },
      { text: 'Grows faster than prices', isCorrect: false },
      { text: 'Loses the 3% interest too', isCorrect: false },
    ],
  },
  {
    topicKey: 'money-basics',
    difficulty: 3,
    kind: 'SINGLE',
    text: 'Rahul gets a 10% salary hike, but prices rose 12% this year. Is he richer?',
    explanation:
      'His pay went up in numbers, but prices rose faster, so he can buy less. What matters is money after inflation, not before.',
    options: [
      { text: 'Yes, his pay went up', isCorrect: false },
      { text: 'No, he can buy less than before', isCorrect: true },
      { text: 'Yes, a hike always means richer', isCorrect: false },
      { text: 'No, but only because of taxes', isCorrect: false },
    ],
  },
  {
    topicKey: 'banking-saving',
    difficulty: 1,
    kind: 'SINGLE',
    text: 'What does a bank mainly do with the money you deposit?',
    explanation:
      'Banks lend most deposits to borrowers and pay interest from those loans; only a small part is kept as cash.',
    options: [
      { text: 'Lends it out and earns interest on the loans', isCorrect: true },
      { text: 'Keeps every rupee locked in a vault', isCorrect: false },
      { text: 'Invests it all in the stock market', isCorrect: false },
      { text: 'Gives it away as charity', isCorrect: false },
    ],
  },
  {
    topicKey: 'banking-saving',
    difficulty: 2,
    kind: 'SINGLE',
    text: 'Priya needs a house down payment in 2 years. Where should she keep that money?',
    explanation:
      'Short-term goals need safety and easy access, so a savings account fits better than risky investments.',
    options: [
      { text: 'In a savings account, safe and easy to withdraw', isCorrect: true },
      { text: 'In high-risk shares, to grow it fast', isCorrect: false },
      { text: 'Lent to a friend with no written terms', isCorrect: false },
      { text: 'Buried at home as cash', isCorrect: false },
    ],
  },
  {
    topicKey: 'banking-saving',
    difficulty: 3,
    kind: 'SINGLE',
    text: 'Amit says an emergency fund should cover "one month of salary". What is wrong with this?',
    explanation:
      'An emergency fund should cover months of living expenses, since job loss can last longer than a month and expenses differ from salary.',
    options: [
      { text: 'One month is too little for most job losses', isCorrect: true },
      { text: 'Emergency funds must be in shares, not cash', isCorrect: false },
      { text: 'Salary and expenses are the same thing', isCorrect: false },
      { text: 'Nothing is wrong; one month is the full rule', isCorrect: false },
    ],
  },
  {
    topicKey: 'markets',
    difficulty: 1,
    kind: 'SINGLE',
    text: 'When you buy a share of a company, what do you own?',
    explanation:
      'A share is a small piece of ownership in the business, so its value rises and falls with the company.',
    options: [
      { text: 'A small piece of ownership in the company', isCorrect: true },
      { text: 'A loan you gave to the company', isCorrect: false },
      { text: 'A guaranteed fixed payment every month', isCorrect: false },
      { text: 'A ticket to vote in national elections', isCorrect: false },
    ],
  },
  {
    topicKey: 'markets',
    difficulty: 2,
    kind: 'SINGLE',
    text: 'Interest rates in the market rise. What usually happens to the price of existing bonds?',
    explanation:
      'New bonds pay the higher rate, so old bonds with lower rates become less attractive and their prices fall.',
    options: [
      { text: 'They stay the same', isCorrect: false },
      { text: 'They usually fall', isCorrect: true },
      { text: 'They usually rise', isCorrect: false },
      { text: 'They stop paying interest', isCorrect: false },
    ],
  },
  {
    topicKey: 'markets',
    difficulty: 3,
    kind: 'MULTI',
    text: 'Which of these statements about risk and return are TRUE? (Select all that apply)',
    explanation:
      'Higher expected returns come with higher risk, and risk means the outcome is uncertain — including the chance of loss.',
    options: [
      { text: 'Higher expected return usually means higher risk', isCorrect: true },
      { text: 'Risk means outcomes are uncertain, including losses', isCorrect: true },
      { text: 'High returns can come with no risk if you pick well', isCorrect: false },
      { text: 'Low-risk investments always beat inflation', isCorrect: false },
    ],
  },
  {
    topicKey: 'investor-mindset',
    difficulty: 1,
    kind: 'SINGLE',
    text: 'What is compounding?',
    explanation:
      'Compounding means your returns also start earning returns, so growth speeds up over time.',
    options: [
      { text: 'Earning returns on your returns, not just your original money', isCorrect: true },
      { text: 'Paying the same fee every year', isCorrect: false },
      { text: 'Dividing money equally between friends', isCorrect: false },
      { text: 'Losing money slowly over time', isCorrect: false },
    ],
  },
  {
    topicKey: 'investor-mindset',
    difficulty: 2,
    kind: 'SINGLE',
    text: 'Meera starts investing a small amount at age 25. Karan starts at 35 with the same amount. Both earn the same returns. Who likely ends up with more at 60?',
    explanation:
      'Starting earlier gives compounding more years to work, which usually beats starting later with the same amount.',
    options: [
      { text: 'Meera, because her money has more time to grow', isCorrect: true },
      { text: 'Karan, because older investors get better returns', isCorrect: false },
      { text: 'Both, exactly the same', isCorrect: false },
      { text: 'Neither; starting age does not matter', isCorrect: false },
    ],
  },
  {
    topicKey: 'investor-mindset',
    difficulty: 3,
    kind: 'MULTI',
    text: 'Which of these are red flags in an investment pitch? (Select all that apply)',
    explanation:
      'No honest investment can guarantee high returns without risk, and pressure tactics are a classic scam signal. A registered advisor who discloses fees and explains risks is doing the right thing.',
    options: [
      { text: 'Guaranteed high returns with no risk', isCorrect: true },
      { text: 'SEBI-registered advisor disclosing fees', isCorrect: false },
      { text: 'Pressure to invest today or miss out', isCorrect: true },
      { text: 'A written explanation of risks', isCorrect: false },
    ],
  },
];
