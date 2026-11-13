/**
 * Prisma seed — the Money Foundations track (Phase 1).
 *
 * ALL lesson content below is ORIGINAL, written for Candle. It was not
 * copied from Zerodha Varsity or any other source (blueprint §16, legal
 * guardrails). Varsity was used only as a topic reference for what a
 * beginner curriculum should cover.
 *
 * Every company, ticker, and number is FICTIONAL and clearly labeled.
 * Every lesson ends with the educational-purpose disclaimer.
 *
 * Idempotent: re-running updates titles/descriptions and publishes only
 * lessons that have no published version yet. Published versions are
 * never overwritten.
 */
import { ContentStatus, Prisma, PrismaClient } from '@prisma/client';
import { BADGE_DEFINITIONS } from '../src/modules/gamification/badge.service';
import { ASSESSMENT_BANK_V1 } from './assessment-bank';
import { DUEL_BANK_SEED_ITEMS, DUEL_BANK_SEED_TEMPLATES } from './question-bank-seed';

const prisma = new PrismaClient();

const DISCLAIMER =
  '\n\n---\n*Educational purpose only — this is not investment advice. ' +
  'All companies, tickers, and numbers are fictional illustrations.*';

interface SeedOption {
  text: string;
  isCorrect: boolean;
}

interface SeedQuestion {
  text: string;
  explanation: string;
  kind: 'SINGLE' | 'MULTI';
  options: SeedOption[];
}

interface SeedLesson {
  title: string;
  content: string;
  questions: SeedQuestion[];
}

interface SeedModule {
  title: string;
  description: string;
  lessons: SeedLesson[];
}

const MODULES: SeedModule[] = [
  {
    title: 'Money Basics',
    description: 'What money is, why prices rise, and how to tell your money where to go.',
    lessons: [
      {
        title: 'What Money Really Is',
        content: `Imagine you grow wheat and your neighbor makes shoes. You want shoes, but she doesn't want wheat — she wants a haircut. In a barter economy, every trade needs a double coincidence of wants, and complex economies would grind to a halt.

Money solves this by being three things at once:

1. **A medium of exchange** — everyone accepts it, so you can trade with anyone.
2. **A store of value** — it (mostly) keeps its worth over time, so you can save today and spend later.
3. **A unit of account** — prices are quoted in it, so you can compare a kilo of rice with a haircut.

The rupees in your pocket are *fiat* money: they have value because the government says so and because everyone agrees to accept them. They aren't backed by gold in a vault. That agreement — trust — is the entire foundation of the financial system you'll learn about in this track.

Why does this matter for you? Because every financial decision — saving, borrowing, investing — is a decision about moving money through *time*. Understanding what money is helps you see through hype: anyone promising to "multiply your money" is really promising to move it through time and risk on your behalf. Always ask how.`,
        questions: [
          {
            text: 'Which of these is NOT one of the three classic functions of money?',
            explanation:
              'Money serves as a medium of exchange, a store of value, and a unit of account. Generating investment returns is something you do *with* money, not a function of money itself.',
            kind: 'SINGLE',
            options: [
              { text: 'Medium of exchange', isCorrect: false },
              { text: 'Store of value', isCorrect: false },
              { text: 'Guaranteed growth over time', isCorrect: true },
              { text: 'Unit of account', isCorrect: false },
            ],
          },
          {
            text: 'Fiat money (like the rupee) has value primarily because…',
            explanation:
              'Fiat currency is not backed by gold or silver. Its value comes from government decree and collective trust — everyone accepts it because everyone else accepts it.',
            kind: 'SINGLE',
            options: [
              { text: 'It can be exchanged for gold at any bank', isCorrect: false },
              {
                text: 'The government declares it legal tender and people trust it',
                isCorrect: true,
              },
              { text: 'It is printed on special expensive paper', isCorrect: false },
              { text: 'Its supply can never change', isCorrect: false },
            ],
          },
          {
            text: 'Which situations show the "double coincidence of wants" problem? (Select all that apply)',
            explanation:
              'Barter requires both parties to want what the other offers. The wheat farmer and the shoemaker are stuck unless their wants coincide; money removes this friction.',
            kind: 'MULTI',
            options: [
              {
                text: 'A wheat farmer wants shoes, but the shoemaker wants a haircut',
                isCorrect: true,
              },
              { text: 'A shopkeeper accepts rupees from every customer', isCorrect: false },
              { text: 'Two friends swap books they have both already read', isCorrect: true },
              { text: 'An employee receives a monthly salary in rupees', isCorrect: false },
            ],
          },
        ],
      },
      {
        title: 'Inflation: The Silent Tax',
        content: `In 2015, a plate of your favorite street food cost ₹50. Today it costs ₹90. The food didn't get better — your money got weaker. That weakening is **inflation**: a general rise in prices over time, which is the same as a fall in the purchasing power of money.

A little inflation is normal. India's central bank, the RBI, aims to keep it around 4%. But it compounds against you: at 6% annual inflation, ₹1,00,000 sitting idle in a drawer buys what only ~₹56,000 buys today after 10 years.

Inflation comes from a few places:
- **Demand-pull**: too much money chasing too few goods (a booming economy).
- **Cost-push**: inputs get costlier — oil prices rise, so transport and food get costlier.
- **Money supply**: when a lot of new money enters the system, each unit is worth a little less.

The lesson for a beginner is simple and powerful: **money left idle shrinks in real terms**. Saving is essential (you'll learn about emergency funds next module), but long-term wealth needs your money to grow *faster than inflation*. That gap — between inflation and growth — is the entire reason investing exists.`,
        questions: [
          {
            text: 'If inflation is 6% a year, what happens to ₹1,00,000 kept as cash for 10 years?',
            explanation:
              'At 6% inflation, purchasing power roughly halves in about 12 years. After 10 years your ₹1,00,000 buys roughly what ₹56,000 buys today — the money looks the same, but it buys far less.',
            kind: 'SINGLE',
            options: [
              { text: 'It stays exactly the same in value', isCorrect: false },
              { text: 'It buys noticeably less than it does today', isCorrect: true },
              { text: 'It grows because cash earns interest automatically', isCorrect: false },
              { text: 'It doubles because prices rise', isCorrect: false },
            ],
          },
          {
            text: 'Which of these can cause inflation? (Select all that apply)',
            explanation:
              'Strong demand bidding up prices (demand-pull), costlier inputs like oil (cost-push), and rapid growth in the money supply can all push the general price level up.',
            kind: 'MULTI',
            options: [
              { text: 'Consumers spending strongly on limited goods', isCorrect: true },
              { text: 'A sharp rise in crude oil prices', isCorrect: true },
              { text: 'Everyone suddenly saving more and spending less', isCorrect: false },
              { text: 'A large increase in the money supply', isCorrect: true },
            ],
          },
          {
            text: 'Why does inflation make investing necessary, not optional?',
            explanation:
              'Idle money loses purchasing power every year. To preserve and grow real wealth, your money needs to earn more than the inflation rate over the long run.',
            kind: 'SINGLE',
            options: [
              { text: 'Because the government requires everyone to invest', isCorrect: false },
              {
                text: 'Because idle money loses purchasing power, so savings must grow faster than inflation',
                isCorrect: true,
              },
              { text: 'Because inflation makes bank deposits illegal', isCorrect: false },
              { text: 'Because prices never change otherwise', isCorrect: false },
            ],
          },
        ],
      },
      {
        title: 'Budgeting Basics',
        content: `Budgeting has a boring reputation and an exciting result: control. A budget is simply a plan that tells your money where to go *before* the month tells you where it went.

A good starting framework is **50/30/20**:
- **50% for needs** — rent, food, transport, bills, EMIs.
- **30% for wants** — eating out, shopping, entertainment.
- **20% for future you** — savings and investments, paid first, not last.

Three habits make it stick:

1. **Pay yourself first.** Move the 20% to savings the day money arrives. What remains is what you can spend — not the other way around.
2. **Track for one month.** You can't fix what you can't see. One month of honest tracking usually reveals 2–3 "money leaks" (subscriptions you forgot, daily impulse buys).
3. **Give every rupee a job.** At the start of the month, assign your income to categories. A budget that lives in your head doesn't count.

Budgeting isn't about never spending on fun — the 30% is guilt-free by design. It's about making spending a *choice* instead of an accident. Every wealthy person you admire started with the unglamorous habit of spending less than they earn.`,
        questions: [
          {
            text: 'In the 50/30/20 rule, what does the 20% stand for?',
            explanation:
              '20% goes to your future self — savings and investments. The key insight is paying this first, before spending on wants.',
            kind: 'SINGLE',
            options: [
              { text: 'Entertainment and dining out', isCorrect: false },
              { text: 'Savings and investments, paid first', isCorrect: true },
              { text: 'Emergency borrowing capacity', isCorrect: false },
              { text: 'Taxes', isCorrect: false },
            ],
          },
          {
            text: '"Pay yourself first" means…',
            explanation:
              'Moving savings out on day one removes temptation and makes saving automatic. Saving "whatever is left" at month-end usually means saving nothing.',
            kind: 'SINGLE',
            options: [
              { text: 'Spending on yourself before paying bills', isCorrect: false },
              { text: 'Moving money to savings as soon as income arrives', isCorrect: true },
              { text: 'Withdrawing cash for daily expenses first', isCorrect: false },
              { text: 'Paying off friends before family', isCorrect: false },
            ],
          },
          {
            text: 'Which habits make a budget actually work? (Select all that apply)',
            explanation:
              'Tracking reveals leaks, assigning every rupee a job makes the plan concrete, and paying yourself first protects savings. Avoiding all fun spending is unsustainable — the framework budgets for wants deliberately.',
            kind: 'MULTI',
            options: [
              { text: 'Tracking spending honestly for at least a month', isCorrect: true },
              { text: 'Assigning every rupee a category at month start', isCorrect: true },
              { text: 'Cutting all spending on fun permanently', isCorrect: false },
              { text: 'Automating the savings transfer on payday', isCorrect: true },
            ],
          },
        ],
      },
    ],
  },
];

MODULES.push({
  title: 'Banking & Saving',
  description: 'How banks really work, saving vs investing, and your safety net.',
  lessons: [
    {
      title: 'How Banks Work',
      content: `A bank looks like a safe locker for your money. It's actually a business — and understanding its business model explains half of personal finance.

Here's the simple version: you deposit ₹1,00,000 in a savings account earning 3% a year. The bank lends most of that money to someone else — a home buyer at 9%, a business at 11%. The bank keeps the **spread** (the difference between what it pays you and what it charges borrowers). That's the core business.

What this means for you:

- **Your deposits are safe (up to a limit).** In India, the DICGC insures bank deposits up to ₹5 lakh per depositor per bank. Choose established banks; don't chase shady "high interest" schemes.
- **Savings accounts pay little.** That 3% is the price of instant access and safety — your emergency money belongs here, not your long-term wealth.
- **Loans are the flip side.** Every loan you take makes *you* the bank's customer in reverse — you pay the spread. Borrow consciously: a home loan at 9% for an appreciating asset is very different from a personal loan at 14% for a vacation.
- **CASA matters to banks, not you.** You'll hear banks love "CASA" (current + savings deposits) because it's cheap money for them. For you, the takeaway is just: know what your account pays and what it costs.

Banks are tools. Use them for safety and transactions; don't expect them to build your wealth.`,
      questions: [
        {
          text: 'How does a bank mainly earn its profit?',
          explanation:
            "Banks pay depositors a low rate and lend the money at a higher rate. The spread between the two is their core profit — your 3% savings account funds someone else's 9% home loan.",
          kind: 'SINGLE',
          options: [
            { text: 'By charging locker fees only', isCorrect: false },
            { text: 'From the spread between deposit rates and lending rates', isCorrect: true },
            { text: 'By investing all deposits in the stock market', isCorrect: false },
            { text: 'From government subsidies', isCorrect: false },
          ],
        },
        {
          text: 'In India, bank deposits are insured by DICGC up to…',
          explanation:
            'The Deposit Insurance and Credit Guarantee Corporation insures up to ₹5 lakh per depositor per bank — one reason to prefer established banks over unregulated high-interest schemes.',
          kind: 'SINGLE',
          options: [
            { text: '₹50,000 per depositor per bank', isCorrect: false },
            { text: '₹5 lakh per depositor per bank', isCorrect: true },
            { text: 'There is no deposit insurance in India', isCorrect: false },
            { text: 'Unlimited amount', isCorrect: false },
          ],
        },
        {
          text: 'Which statements about banks are true? (Select all that apply)',
          explanation:
            'Banks profit from the rate spread, savings accounts prioritize safety and liquidity over returns, and borrowing makes you pay the spread in reverse. Banks do not guarantee investment growth.',
          kind: 'MULTI',
          options: [
            {
              text: 'Banks earn from the difference between lending and deposit rates',
              isCorrect: true,
            },
            {
              text: 'Savings accounts are for safety and easy access, not wealth creation',
              isCorrect: true,
            },
            { text: 'Taking a loan means you pay interest to the bank', isCorrect: true },
            { text: 'Banks guarantee your investments will grow', isCorrect: false },
          ],
        },
      ],
    },
    {
      title: 'Saving vs. Investing',
      content: `Saving and investing are not the same sport — they just wear similar jerseys.

**Saving** = keeping money safe and accessible for known, near-term needs. Savings account, emergency fund, next semester's fees. Priority: *don't lose it, keep it reachable.* Returns are low, and that's fine — that's not its job.

**Investing** = putting money to work for long-term growth, accepting that its value will wobble along the way. Stocks, bonds, mutual funds. Priority: *beat inflation over years.* Returns are higher on average, with real risk.

Two questions decide which one a rupee belongs to:

1. **When do I need it?** Under 2–3 years → save it. Five-plus years → it can be invested.
2. **What happens if it drops 20% temporarily?** If that would be a disaster (rent money, emergency fund) → save it. If you can wait out the dip → it can be invested.

Beginners often make two opposite mistakes: keeping *everything* in savings (inflation quietly eats it — remember the silent tax), or investing money they'll need next month (a market dip becomes a real loss when you're forced to sell).

The right order: emergency fund first (saving), then invest for the long term with money you won't need soon.`,
      questions: [
        {
          text: 'What is the key difference between saving and investing?',
          explanation:
            'Saving prioritizes safety and accessibility for near-term needs; investing accepts volatility in pursuit of long-term growth above inflation. Different jobs, different tools.',
          kind: 'SINGLE',
          options: [
            { text: 'Saving is for the rich, investing is for everyone', isCorrect: false },
            {
              text: 'Saving keeps money safe and accessible; investing seeks long-term growth with volatility',
              isCorrect: true,
            },
            { text: 'There is no real difference', isCorrect: false },
            { text: 'Investing is always safer than saving', isCorrect: false },
          ],
        },
        {
          text: 'You need ₹40,000 for college fees due in 4 months. What should you do?',
          explanation:
            'Money needed in months — not years — must stay safe and liquid. A market dip right before fees are due would turn a temporary fall into a permanent loss.',
          kind: 'SINGLE',
          options: [
            { text: 'Invest it in stocks for maximum growth', isCorrect: false },
            { text: 'Keep it in a savings account', isCorrect: true },
            { text: 'Lend it to a friend for interest', isCorrect: false },
            { text: 'Buy cryptocurrency', isCorrect: false },
          ],
        },
        {
          text: 'Which are common beginner mistakes? (Select all that apply)',
          explanation:
            'Keeping everything in savings lets inflation erode wealth, while investing short-term money risks forced selling in a dip. Both mistakes come from mixing up the two jobs.',
          kind: 'MULTI',
          options: [
            { text: 'Keeping all money in a savings account for 20 years', isCorrect: true },
            { text: "Investing next month's rent money in stocks", isCorrect: true },
            { text: 'Building an emergency fund before investing', isCorrect: false },
            { text: 'Matching the tool to the time horizon', isCorrect: false },
          ],
        },
      ],
    },
    {
      title: 'Your Emergency Fund',
      content: `Life is lumpy: phones die, parents need help, internships pay late. An **emergency fund** is 3–6 months of essential expenses parked somewhere safe and instantly accessible. It is the most boring and most important money move you'll ever make.

Why it matters more than any investment tip: without it, every surprise becomes debt. A ₹20,000 emergency on a credit card at 3% *per month* costs far more than any stock tip could earn you. The emergency fund is what lets your investments stay invested when life happens.

How to build it:
- **Size**: add up one month of *essential* spending (rent, food, transport, bills — not wants). Multiply by 3 if your income is stable, by 6 if it's irregular.
- **Where**: a savings account or sweep-in deposit — safe, liquid, separate from daily spending. *Not* in stocks, *not* in crypto, *not* "invested for better returns."
- **How**: automate a fixed transfer each payday until it's full. Even ₹2,000 a month gets a student there within a year or two.
- **Rules**: emergencies only. A sale is not an emergency. A trip is not an emergency. When you use it, rebuilding it becomes priority #1.

Build this before you invest a single rupee. It's the foundation everything else stands on — which is why this track starts here, not with stock tips.`,
      questions: [
        {
          text: 'How large should an emergency fund be?',
          explanation:
            'The standard rule is 3–6 months of essential expenses: 3 if income is stable, 6 if it is irregular. It covers needs, not wants.',
          kind: 'SINGLE',
          options: [
            { text: 'One week of total spending', isCorrect: false },
            { text: '3–6 months of essential expenses', isCorrect: true },
            { text: 'Exactly ₹10 lakh for everyone', isCorrect: false },
            { text: '10% of annual income', isCorrect: false },
          ],
        },
        {
          text: 'Where should an emergency fund be kept?',
          explanation:
            'Emergencies need instant, guaranteed access. Stocks or crypto could be down exactly when you need the money — that defeats the entire purpose.',
          kind: 'SINGLE',
          options: [
            { text: 'In stocks for higher growth', isCorrect: false },
            { text: 'In a savings account — safe and instantly accessible', isCorrect: true },
            { text: 'In cryptocurrency', isCorrect: false },
            { text: 'Lent to friends who pay interest', isCorrect: false },
          ],
        },
        {
          text: 'Which are true about emergency funds? (Select all that apply)',
          explanation:
            'The fund prevents high-interest debt during surprises, must be rebuilt after use, and covers essentials only. Chasing returns with it contradicts its purpose.',
          kind: 'MULTI',
          options: [
            { text: 'It prevents emergencies from becoming high-interest debt', isCorrect: true },
            { text: 'After using it, rebuilding becomes the top priority', isCorrect: true },
            { text: 'It should be invested aggressively for better returns', isCorrect: false },
            { text: 'A vacation counts as an emergency', isCorrect: false },
          ],
        },
      ],
    },
  ],
});

MODULES.push({
  title: 'Markets, Demystified',
  description: 'Stocks, bonds, and the relationship between risk and return.',
  lessons: [
    {
      title: 'What Is a Stock?',
      content: `A stock (or share) is a slice of ownership in a company. When you buy one share of a fictional company — say, **Meridian Textiles Ltd. (fictional ticker: MERD)** — you become a part-owner of Meridian. If the company grows and earns more, your slice is worth more. If it stumbles, your slice is worth less.

Why would a company sell slices of itself? To raise money without borrowing. Instead of taking a loan, Meridian sells 10 lakh shares to the public and uses the cash to build a new factory.

Why does the price move every second? Because a stock exchange is an auction: buyers bid, sellers ask, and the price is simply where they agree *right now*. Prices move on expectations — if investors believe Meridian's new factory will be profitable, they bid higher today, long before any profit appears.

Two ways owners can earn:
- **Price appreciation** — sell later at a higher price than you paid.
- **Dividends** — some companies share a slice of profits in cash.

And the catch, stated plainly: prices can fall, companies can fail, and a stock can go to zero. That's not a flaw in the system — it's the reason returns exist at all. Next lesson: the calmer cousin of stocks.`,
      questions: [
        {
          text: 'What does owning a stock actually mean?',
          explanation:
            "A share is fractional ownership of a business. Its value follows the company's fortunes — growth lifts it, trouble sinks it.",
          kind: 'SINGLE',
          options: [
            { text: 'You lent money to the company and must be repaid', isCorrect: false },
            { text: 'You own a slice of the company', isCorrect: true },
            { text: 'You work for the company', isCorrect: false },
            { text: 'You are guaranteed a fixed return', isCorrect: false },
          ],
        },
        {
          text: 'Why do stock prices change every second?',
          explanation:
            'An exchange is a continuous auction. Every trade is a buyer and seller agreeing on a price at that instant, driven by changing expectations about the future.',
          kind: 'SINGLE',
          options: [
            { text: 'The government sets the price daily', isCorrect: false },
            {
              text: 'Buyers and sellers continuously agree on new prices in an auction',
              isCorrect: true,
            },
            { text: 'Companies change their profits every second', isCorrect: false },
            { text: 'Prices are random and meaningless', isCorrect: false },
          ],
        },
        {
          text: 'Which are ways a stock owner can earn? (Select all that apply)',
          explanation:
            'Owners earn if the share price rises (appreciation) or if the company pays out profits as dividends. Neither is guaranteed — that uncertainty is the risk you are paid to take.',
          kind: 'MULTI',
          options: [
            { text: 'Selling the share later at a higher price', isCorrect: true },
            { text: 'Receiving dividends from company profits', isCorrect: true },
            { text: 'A fixed guaranteed interest every year', isCorrect: false },
            { text: 'Getting your original amount back no matter what', isCorrect: false },
          ],
        },
      ],
    },
    {
      title: 'Bonds & Fixed Income',
      content: `If a stock is *owning* a slice of a company, a **bond** is *lending* money to one — or to a government. You hand over ₹10,000; the borrower promises to pay you interest (the **coupon**) every year and return your ₹10,000 on a fixed date ( **maturity**).

Example: a fictional **Harbor Foods 5-year bond (fictional)** pays 8% a year. You invest ₹10,000, collect ₹800 every year, and get your ₹10,000 back in year 5. Simple, predictable — *if* Harbor Foods stays solvent.

Key ideas:
- **Bonds are calmer than stocks.** Your return doesn't depend on the company's growth, just its ability to pay. In exchange, long-run returns are usually lower.
- **Interest rates move bond prices.** If new bonds pay 10%, nobody wants your old 8% bond unless its price drops. (This "seesaw" confuses beginners — just remember: rates up, old bond prices down.)
- **Governments borrow too.** Government bonds are considered the safest in a country — when people say "risk-free rate," this is roughly what they mean.
- **Credit risk is real.** A bond is only as safe as its borrower. "High yield" is often just a nicer name for "high risk of not getting paid."

For a beginner's portfolio, bonds (or bond mutual funds) are the stabilizers — the part that lets you sleep while stocks do their rollercoaster thing.`,
      questions: [
        {
          text: 'What is a bond?',
          explanation:
            'A bond is a loan you give to a company or government: regular interest (coupon) plus your principal back at maturity — provided the borrower stays solvent.',
          kind: 'SINGLE',
          options: [
            { text: 'A slice of ownership in a company', isCorrect: false },
            {
              text: 'A loan to a company or government with promised interest and principal repayment',
              isCorrect: true,
            },
            { text: 'A type of savings account', isCorrect: false },
            { text: 'A guaranteed doubling of money', isCorrect: false },
          ],
        },
        {
          text: 'If market interest rates rise, what typically happens to existing bond prices?',
          explanation:
            'New bonds pay more, so old lower-coupon bonds are less attractive — their prices fall until their effective yield competes. Rates up, old bond prices down.',
          kind: 'SINGLE',
          options: [
            { text: 'They rise too', isCorrect: false },
            { text: 'They usually fall', isCorrect: true },
            { text: 'They never change', isCorrect: false },
            { text: 'They convert into stocks', isCorrect: false },
          ],
        },
        {
          text: 'Which statements about bonds are true? (Select all that apply)',
          explanation:
            'Bonds trade growth potential for predictability, are only as safe as the borrower, and government bonds anchor the "risk-free" end of the spectrum.',
          kind: 'MULTI',
          options: [
            {
              text: 'Bond returns are generally calmer and lower than stock returns',
              isCorrect: true,
            },
            { text: 'A bond is only as safe as the borrower behind it', isCorrect: true },
            { text: 'All bonds are completely risk-free', isCorrect: false },
            { text: 'Government bonds are among the safest in a country', isCorrect: true },
          ],
        },
      ],
    },
    {
      title: 'Risk and Return',
      content: `Here's the one sentence that explains all of investing: **higher expected returns always come with higher risk.** Anyone offering high returns with "no risk" is selling you something — probably a lie.

**Risk** in finance doesn't mean "danger" — it means *uncertainty*, usually measured as **volatility**: how much prices swing up and down. A stock that swings ±30% a year is riskier than a bond that swings ±3%.

The tradeoff in action:
- Savings account: ~3%, near-zero volatility.
- Government bonds: ~7%, low volatility.
- Stocks (long run): ~10–12%, high volatility — with years where you're down 20%.

Notice the pattern: each step up in return demands accepting bigger swings. There is no asset that pays 15% steadily with no down years. If there were, all the world's money would already be in it.

Three practical takeaways:
1. **Match risk to horizon.** Money you need in 1 year can't afford volatility; money you need in 15 years can ride it out.
2. **Volatility is the fee, not the fine.** The dips are the price of admission for long-term returns. Investors who panic-sell in dips pay the fee without getting the returns.
3. **Diversification softens risk** (next module) — but it never eliminates the tradeoff.

Internalize this and you're already ahead of most beginners chasing "safe 20% returns."`,
      questions: [
        {
          text: 'What is the fundamental relationship between risk and return?',
          explanation:
            'Markets compensate risk with higher expected returns. Any offer of high returns with no risk contradicts how markets work — treat it as a red flag.',
          kind: 'SINGLE',
          options: [
            { text: 'Higher expected returns always come with higher risk', isCorrect: true },
            { text: 'Higher returns always mean lower risk', isCorrect: false },
            { text: 'Risk and return are unrelated', isCorrect: false },
            { text: 'Safe assets always outperform risky ones', isCorrect: false },
          ],
        },
        {
          text: 'In finance, "risk" most precisely means…',
          explanation:
            'Risk is uncertainty of outcomes, commonly measured as volatility — the size of price swings. A "risky" asset is one whose returns swing widely, up or down.',
          kind: 'SINGLE',
          options: [
            { text: 'The certainty of losing money', isCorrect: false },
            { text: 'Uncertainty of outcomes, often measured as volatility', isCorrect: true },
            { text: 'Fraud by the company', isCorrect: false },
            { text: 'Government taxation', isCorrect: false },
          ],
        },
        {
          text: 'Someone promises you "18% annual returns with zero risk." What should you think? (Select all that apply)',
          explanation:
            'The risk-return tradeoff says this combination does not exist in legitimate markets. It is either a misunderstanding or, more likely, a scam.',
          kind: 'MULTI',
          options: [
            { text: 'This contradicts the risk-return tradeoff', isCorrect: true },
            { text: 'It is likely a scam or mis-selling', isCorrect: true },
            { text: 'This is a normal safe investment', isCorrect: false },
            { text: 'I should invest immediately before it fills up', isCorrect: false },
          ],
        },
      ],
    },
  ],
});

MODULES.push({
  title: 'Think Like an Investor',
  description: 'Compounding, diversification, and the traps that catch beginners.',
  lessons: [
    {
      title: 'The Power of Compounding',
      content: `Compounding is growth earning growth — and it's the closest thing investing has to magic.

Put ₹10,000 in something earning 12% a year. After year 1: ₹11,200. In year 2 you earn 12% on ₹11,200, not ₹10,000. After 10 years: ~₹31,000. After 20 years: ~₹96,000. After 30 years: ~₹3,00,000. The first decade feels slow; the later decades do the heavy lifting. That's the curve everyone underestimates.

Three implications that should change your behavior *today*:

1. **Starting early beats investing more later.** ₹5,000/month from age 20 to 30 (₹6 lakh invested) beats ₹5,000/month from age 30 to 60 (₹18 lakh invested) at the same return — because the early money compounds for decades longer.
2. **Returns compound; so do costs.** A 2% annual fee doesn't sound like much, but over 30 years it can eat roughly a third of your wealth. Low costs matter enormously.
3. **Patience is the strategy.** Compounding needs time and zero interruption. Every panic withdrawal resets the clock.

You don't need a brilliant stock pick to benefit. You need time, consistency, and the discipline to leave it alone. As a student, time is the one asset you have in abundance — spend it wisely.`,
      questions: [
        {
          text: 'Why does compounding accelerate over time?',
          explanation:
            "Each year's growth is calculated on a bigger base — returns earn their own returns. The curve starts flat and steepens, which is why the later years contribute the most.",
          kind: 'SINGLE',
          options: [
            { text: 'Because interest rates always rise', isCorrect: false },
            { text: 'Because growth earns growth on an ever-larger base', isCorrect: true },
            { text: 'Because inflation helps investors', isCorrect: false },
            { text: 'Because the government adds bonuses', isCorrect: false },
          ],
        },
        {
          text: 'Asha invests ₹5,000/month from age 20–30 then stops. Ravi invests ₹5,000/month from age 30–60. Same 12% return. Who likely ends with more at 60?',
          explanation:
            "Time beats money. Asha's early contributions compound for 30–40 years, while Ravi's larger total contributions have far less time to grow. Starting early is the highest-leverage move.",
          kind: 'SINGLE',
          options: [
            { text: 'Ravi, because he invested three times as much', isCorrect: false },
            { text: 'Asha, because her money compounds for decades longer', isCorrect: true },
            { text: 'They end with exactly the same', isCorrect: false },
            { text: 'Neither — inflation wipes it all out', isCorrect: false },
          ],
        },
        {
          text: 'Which statements about compounding are true? (Select all that apply)',
          explanation:
            'Compounding rewards early starts and punishes high fees and interruptions. It does not require brilliant picks — consistency and time do the work.',
          kind: 'MULTI',
          options: [
            {
              text: 'Starting early matters more than investing large amounts late',
              isCorrect: true,
            },
            { text: 'High annual fees significantly reduce long-term wealth', isCorrect: true },
            { text: 'Withdrawing in a panic has no effect on compounding', isCorrect: false },
            { text: 'You need brilliant stock picks for compounding to work', isCorrect: false },
          ],
        },
      ],
    },
    {
      title: "Diversification: Don't Put All Eggs in One Basket",
      content: `If you invest everything in one fictional company — say, Meridian Textiles (MERD) — and Meridian has a terrible year, your entire portfolio has a terrible year. **Diversification** fixes this: spread money across many investments so no single failure can sink you.

How it works in practice:
- **Across companies**: own 20–30 stocks instead of 2–3, or simpler —
- **Across sectors**: textiles, banking, tech, pharma — different industries stumble at different times.
- **Across asset types**: some stocks, some bonds. When stocks fall, bonds often hold steady.
- **Across time**: invest a fixed amount every month (a **SIP** — systematic investment plan). You automatically buy more shares when prices are low and fewer when high.

The easiest diversification for a beginner is a **mutual fund** or **index fund**: one purchase that instantly holds dozens or hundreds of companies, managed (or automatically tracked) for a small fee. An index fund tracking the Nifty 50, for example, gives you a slice of India's 50 largest companies in one click.

What diversification does NOT do: it doesn't eliminate risk (the whole market can fall), and it doesn't multiply returns. It trades the *chance* of a spectacular win on one stock for the *certainty* of never being wiped out by one. For long-term wealth, that's a trade worth making.`,
      questions: [
        {
          text: 'What is the main purpose of diversification?',
          explanation:
            'Spreading investments ensures no single company, sector, or asset can sink the whole portfolio. It controls risk, not a return booster.',
          kind: 'SINGLE',
          options: [
            { text: 'To guarantee higher returns than the market', isCorrect: false },
            { text: 'To ensure no single failure can wipe out the portfolio', isCorrect: true },
            { text: 'To avoid paying any fees', isCorrect: false },
            { text: 'To eliminate all investment risk', isCorrect: false },
          ],
        },
        {
          text: 'What does a SIP (systematic investment plan) do?',
          explanation:
            'A fixed monthly investment buys more units when prices are low and fewer when high — automatic diversification across time, with no timing decisions needed.',
          kind: 'SINGLE',
          options: [
            {
              text: 'Invests a fixed amount regularly, buying more when prices are low',
              isCorrect: true,
            },
            { text: 'Puts all money in at the perfect market bottom', isCorrect: false },
            { text: 'Guarantees profits every month', isCorrect: false },
            { text: 'Is a type of savings account', isCorrect: false },
          ],
        },
        {
          text: 'Which are valid ways to diversify? (Select all that apply)',
          explanation:
            'Diversification works across companies, sectors, asset classes, and time. Concentrating everything in one stock is the opposite of diversification.',
          kind: 'MULTI',
          options: [
            { text: 'Holding stocks across different industries', isCorrect: true },
            { text: 'Mixing stocks with bonds', isCorrect: true },
            { text: 'Investing a fixed amount every month', isCorrect: true },
            { text: 'Putting everything into one promising stock', isCorrect: false },
          ],
        },
      ],
    },
    {
      title: 'Traps Beginners Fall Into',
      content: `Knowledge is half the game; the other half is dodging the traps designed — accidentally or deliberately — to catch beginners.

**Trap 1: Hot tips.** "My uncle's friend says this stock will double!" Tips are how other people exit their bad decisions. By the time a tip reaches you, the profit has usually been taken. Invest in what you understand, not what you heard.

**Trap 2: FOMO.** Everyone's posting crypto profits; you feel left behind. FOMO makes you buy at the top, exactly when excitement — not value — is highest. If you don't understand it, you don't buy it. Simple rule, hard discipline.

**Trap 3: Leverage and F&O.** Futures and options let you control big positions with small money — and lose big just as fast. Most beginners who touch derivatives lose money within months. These are professional tools, not beginner tools.

**Trap 4: "Guaranteed returns."** Remember risk and return: guaranteed + high return = impossible. Anyone promising it is running a scam or doesn't understand finance. Either way, walk away.

**Trap 5: Checking prices daily.** Daily noise triggers emotional decisions. Long-term investors check occasionally and rebalance rarely.

The through-line: **slow, boring, diversified, and patient beats exciting every time.** The investors who build real wealth are rarely the ones with the thrilling stories — they're the ones who avoided the traps, kept costs low, and let compounding work for decades.`,
      questions: [
        {
          text: 'Why are "hot tips" dangerous for beginners?',
          explanation:
            "Tips usually arrive after the profit is taken — they are often someone else's exit. Investing requires your own understanding, not borrowed conviction.",
          kind: 'SINGLE',
          options: [
            { text: 'Because tips are always illegal', isCorrect: false },
            {
              text: 'Because by the time a tip reaches you, the opportunity is usually gone',
              isCorrect: true,
            },
            { text: 'Because tips only work for experts', isCorrect: false },
            { text: 'Because the government bans them', isCorrect: false },
          ],
        },
        {
          text: 'Why should beginners avoid futures & options (F&O)?',
          explanation:
            'Leverage magnifies losses as well as gains, and derivatives expire — most beginners lose money quickly. They are professional instruments requiring deep understanding.',
          kind: 'SINGLE',
          options: [
            { text: 'Because they are boring', isCorrect: false },
            {
              text: 'Because leverage can wipe out capital fast and most beginners lose money in them',
              isCorrect: true,
            },
            { text: 'Because they are only for foreign investors', isCorrect: false },
            { text: 'Because they always expire worthless', isCorrect: false },
          ],
        },
        {
          text: 'Which are classic beginner traps? (Select all that apply)',
          explanation:
            'Chasing tips, FOMO buying, leverage without understanding, and believing "guaranteed high returns" are the four horsemen of beginner losses. Patience and diversification are the antidotes.',
          kind: 'MULTI',
          options: [
            { text: 'Buying on hot tips without understanding the business', isCorrect: true },
            { text: 'FOMO-buying assets you do not understand at peak hype', isCorrect: true },
            { text: 'Using leverage and derivatives as a beginner', isCorrect: true },
            { text: 'Believing "guaranteed high returns" offers', isCorrect: true },
          ],
        },
      ],
    },
  ],
});

// --- seed runner ---------------------------------------------------------------

async function main(): Promise<void> {
  // Badges (idempotent).
  for (const def of BADGE_DEFINITIONS) {
    await prisma.badge.upsert({
      where: { slug: def.slug },
      update: { name: def.name, description: def.description },
      create: def,
    });
  }
  console.log(`Seeded ${BADGE_DEFINITIONS.length} badge definitions.`);

  // Simulator instruments (idempotent by symbol). ALL tickers are fictional —
  // invented companies, invented symbols, never real securities (ADR 0003/2).
  const instruments = [
    {
      symbol: 'NVLT',
      name: 'NovaVolt Energy',
      description: 'Fictional renewable-energy equipment maker.',
      basePrice: 842.5,
    },
    {
      symbol: 'KVRF',
      name: 'Kaveri Foods',
      description: 'Fictional packaged-foods company.',
      basePrice: 315.2,
    },
    {
      symbol: 'ASTL',
      name: 'AstraLogix',
      description: 'Fictional logistics software company.',
      basePrice: 1204.0,
    },
    {
      symbol: 'MRUM',
      name: 'Meru Motors',
      description: 'Fictional electric two-wheeler maker.',
      basePrice: 96.75,
    },
    {
      symbol: 'SGNR',
      name: 'Sagar Semiconductors',
      description: 'Fictional chip-design company.',
      basePrice: 2210.4,
    },
    {
      symbol: 'HELX',
      name: 'Helix Healthcare',
      description: 'Fictional diagnostics chain.',
      basePrice: 458.9,
    },
  ];
  for (const inst of instruments) {
    await prisma.simInstrument.upsert({
      where: { symbol: inst.symbol },
      update: {
        name: inst.name,
        description: inst.description,
        basePrice: inst.basePrice,
        active: true,
      },
      create: inst,
    });
  }
  console.log(`Seeded ${instruments.length} fictional simulator instruments.`);

  // Track (idempotent by slug).
  const track = await prisma.track.upsert({
    where: { slug: 'foundations' },
    update: {
      title: 'Money Foundations',
      description:
        'A complete beginner track: money, banking, markets, and the investor mindset. Original Candle curriculum.',
      order: 0,
      status: ContentStatus.PUBLISHED,
    },
    create: {
      slug: 'foundations',
      title: 'Money Foundations',
      description:
        'A complete beginner track: money, banking, markets, and the investor mindset. Original Candle curriculum.',
      order: 0,
      status: ContentStatus.PUBLISHED,
    },
  });

  let lessonCount = 0;
  let questionCount = 0;

  for (const [mi, mod] of MODULES.entries()) {
    const existingModule = await prisma.learningModule.findFirst({
      where: { trackId: track.id, order: mi },
    });
    const dbModule = existingModule
      ? await prisma.learningModule.update({
          where: { id: existingModule.id },
          data: { title: mod.title, description: mod.description, status: ContentStatus.PUBLISHED },
        })
      : await prisma.learningModule.create({
          data: {
            trackId: track.id,
            title: mod.title,
            description: mod.description,
            order: mi,
            status: ContentStatus.PUBLISHED,
          },
        });

    for (const [li, lesson] of mod.lessons.entries()) {
      let dbLesson = await prisma.lesson.findFirst({
        where: { moduleId: dbModule.id, order: li },
      });
      if (dbLesson) {
        dbLesson = await prisma.lesson.update({
          where: { id: dbLesson.id },
          data: { title: lesson.title },
        });
      } else {
        dbLesson = await prisma.lesson.create({
          data: { moduleId: dbModule.id, title: lesson.title, order: li },
        });
      }
      lessonCount += 1;

      // Never overwrite a published version — publish only fresh content.
      const published = await prisma.lessonVersion.findFirst({
        where: { lessonId: dbLesson.id, status: ContentStatus.PUBLISHED },
        orderBy: { version: 'desc' },
      });
      if (published) continue;

      const maxVersion = await prisma.lessonVersion.findFirst({
        where: { lessonId: dbLesson.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = await prisma.lessonVersion.create({
        data: {
          lessonId: dbLesson.id,
          version: (maxVersion?.version ?? 0) + 1,
          title: lesson.title,
          contentMarkdown: lesson.content + DISCLAIMER,
          status: ContentStatus.PUBLISHED,
          publishedAt: new Date(),
        },
      });

      for (const [qi, question] of lesson.questions.entries()) {
        await prisma.question.create({
          data: {
            lessonVersionId: version.id,
            text: question.text,
            explanation: question.explanation,
            kind: question.kind,
            order: qi,
            points: 10,
            options: {
              create: question.options.map((o, oi) => ({
                text: o.text,
                isCorrect: o.isCorrect,
                order: oi,
              })),
            },
          },
        });
        questionCount += 1;
      }
    }
  }

  console.log(`Seeded track "foundations": ${lessonCount} lessons, ${questionCount} questions.`);

  // Assessment bank v1 (idempotent). Published versions are immutable —
  // the seed publishes only when the track has no published version yet.
  // All 12 questions are original Candle content (docs/03 §3.3).
  const publishedBank = await prisma.assessmentVersion.findFirst({
    where: { trackId: track.id, status: ContentStatus.PUBLISHED },
    orderBy: { version: 'desc' },
  });
  if (publishedBank) {
    console.log(`Assessment bank v${publishedBank.version} already published; skipping.`);
  } else {
    const maxBankVersion = await prisma.assessmentVersion.findFirst({
      where: { trackId: track.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const bankVersion = await prisma.assessmentVersion.create({
      data: {
        trackId: track.id,
        version: (maxBankVersion?.version ?? 0) + 1,
        status: ContentStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });
    for (const [qi, question] of ASSESSMENT_BANK_V1.entries()) {
      await prisma.assessmentQuestion.create({
        data: {
          versionId: bankVersion.id,
          topicKey: question.topicKey,
          difficulty: question.difficulty,
          text: question.text,
          explanation: question.explanation,
          kind: question.kind,
          order: qi,
          options: {
            create: question.options.map((o, oi) => ({
              text: o.text,
              isCorrect: o.isCorrect,
              order: oi,
            })),
          },
        },
      });
    }
    console.log(
      `Seeded assessment bank v${bankVersion.version}: ${ASSESSMENT_BANK_V1.length} questions.`
    );
  }

  // Question Bank (docs/05 §2, ADR 0005 §15). Idempotent by `key`:
  // a LIVE item is never overwritten — it is skipped, like a published
  // lesson version. A non-LIVE item is refreshed from the seed file.
  // Templates seed as DRAFT; generated variants go through review.
  for (const tpl of DUEL_BANK_SEED_TEMPLATES) {
    await prisma.duelBankTemplate.upsert({
      where: { key: tpl.key },
      update: {
        topic: tpl.topic,
        skill: tpl.skill,
        templateText: tpl.templateText,
        parameterSchema: tpl.parameterSchema,
        answerFormula: tpl.answerFormula,
        distractorRules: tpl.distractorRules,
      },
      create: {
        key: tpl.key,
        topic: tpl.topic,
        skill: tpl.skill,
        templateText: tpl.templateText,
        parameterSchema: tpl.parameterSchema,
        answerFormula: tpl.answerFormula,
        distractorRules: tpl.distractorRules,
        status: 'DRAFT',
      },
    });
  }
  let bankLive = 0;
  let bankSkipped = 0;
  for (const item of DUEL_BANK_SEED_ITEMS) {
    const existing = await prisma.duelBankItem.findUnique({
      where: { key: item.key },
      select: { id: true, status: true },
    });
    if (existing?.status === 'LIVE') {
      bankSkipped += 1;
      continue;
    }
    if (existing) {
      await prisma.duelBankOption.deleteMany({ where: { itemId: existing.id } });
      await prisma.duelBankItem.update({
        where: { id: existing.id },
        data: {
          topic: item.topic,
          skill: item.skill,
          type: item.type,
          difficulty: item.difficulty,
          stem: item.stem,
          explanation: item.explanation,
          context: (item.context ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          rubric: item.rubric ?? null,
          chart: (item.chart ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          status: 'LIVE',
          publishedAt: new Date(),
          options: {
            create: item.options.map((o, oi) => ({
              text: o.text,
              isCorrect: o.isCorrect,
              points: o.points ?? 0,
              consequence: o.consequence ?? null,
              order: oi,
            })),
          },
        },
      });
    } else {
      await prisma.duelBankItem.create({
        data: {
          key: item.key,
          topic: item.topic,
          skill: item.skill,
          type: item.type,
          difficulty: item.difficulty,
          stem: item.stem,
          explanation: item.explanation,
          context: (item.context ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          rubric: item.rubric ?? null,
          chart: (item.chart ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          status: 'LIVE',
          publishedAt: new Date(),
          options: {
            create: item.options.map((o, oi) => ({
              text: o.text,
              isCorrect: o.isCorrect,
              points: o.points ?? 0,
              consequence: o.consequence ?? null,
              order: oi,
            })),
          },
        },
      });
    }
    bankLive += 1;
  }
  console.log(
    `Seeded question bank: ${bankLive} LIVE items, ${bankSkipped} already LIVE (skipped), ${DUEL_BANK_SEED_TEMPLATES.length} DRAFT templates.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
