export const MODULES = [
  {
    id: 'module-1',
    title: 'The Stock Market Kingdom',
    subtitle: 'Learn the basics of stocks',
    character: '🏰',
    color: 'from-amber-600 to-orange-700',
    borderColor: 'border-amber-500',
    unlocked: true,
    lessons: ['lesson-1', 'lesson-2', 'lesson-3', 'lesson-4', 'lesson-5'],
  },
  {
    id: 'module-2',
    title: 'The Fundamental Fortress',
    subtitle: 'Master company analysis',
    character: '🔮',
    color: 'from-purple-700 to-violet-800',
    borderColor: 'border-purple-500',
    unlocked: false,
    requiredLessons: ['lesson-1', 'lesson-2', 'lesson-3', 'lesson-4', 'lesson-5'],
    lessons: ['lesson-6', 'lesson-7', 'lesson-8', 'lesson-9', 'lesson-10'],
  },
  {
    id: 'module-3',
    title: 'The Technical Temple',
    subtitle: 'Decode chart patterns',
    character: '⚔️',
    color: 'from-teal-600 to-cyan-700',
    borderColor: 'border-teal-500',
    unlocked: false,
    requiredLessons: ['lesson-6', 'lesson-7', 'lesson-8', 'lesson-9', 'lesson-10'],
    lessons: ['lesson-11', 'lesson-12', 'lesson-13', 'lesson-14', 'lesson-15'],
  },
];

export const LESSONS = {
  'lesson-1': {
    id: 'lesson-1',
    moduleId: 'module-1',
    title: 'What is the Stock Market?',
    subtitle: 'Begin your adventure in the Market Kingdom',
    character: '🧙‍♀️',
    characterName: 'Seraphina the Witch',
    difficulty: 'beginner',
    xpReward: 50,
    duration: '7 min',
    content: `
<h2>Welcome, Adventurer! 🏰</h2>
<p>Imagine a magical marketplace where people buy and sell tiny pieces of companies. That marketplace is called the <strong>Stock Market</strong>!</p>

<h3>What is a Company Share?</h3>
<p>When a company like Reliance or TCS wants to raise money, they break their ownership into millions of tiny pieces called <strong>shares</strong> (or stocks). When you buy one share, you literally own a small piece of that company!</p>

<div class="example-box">
<h4>🏰 The Kingdom Analogy</h4>
<p>Imagine a kingdom worth ₹1,00,000. If you divide it into 1,000 pieces, each piece is worth ₹100. If you buy 10 pieces, you own 1% of the kingdom and get 1% of all its profits!</p>
</div>

<h3>How Does the Stock Market Work?</h3>
<p>The stock market is simply an organized place where buyers and sellers come together to trade shares. In India, we have two main stock exchanges:</p>
<ul>
<li><strong>NSE (National Stock Exchange)</strong> - India's largest exchange, home of NIFTY 50 index</li>
<li><strong>BSE (Bombay Stock Exchange)</strong> - Asia's oldest exchange, home of SENSEX index</li>
</ul>

<h3>Why Do Stock Prices Change?</h3>
<p>Stock prices change every second based on <strong>supply and demand</strong>. If more people want to buy a stock than sell it, the price goes up. If more people want to sell, the price goes down. Simple!</p>

<div class="tip-box">
<h4>🧙‍♀️ Witch's Wisdom</h4>
<p>The stock market is NOT gambling if you understand what you're doing. It's a tool for building long-term wealth. Companies like Infosys have given 50,000%+ returns over 20 years to early investors!</p>
</div>

<h3>Key Terms to Remember</h3>
<ul>
<li><strong>Share/Stock</strong> - Ownership unit of a company</li>
<li><strong>Shareholder</strong> - Person who owns shares</li>
<li><strong>Exchange</strong> - Marketplace for buying/selling stocks (NSE, BSE)</li>
<li><strong>Index</strong> - A basket of stocks representing the market (NIFTY, SENSEX)</li>
<li><strong>SEBI</strong> - Securities and Exchange Board of India - the market regulator/police</li>
</ul>
    `,
    quiz: [
      {
        id: 'q1-1',
        question: 'What do you own when you buy a company\'s share?',
        options: ['A loan to the company', 'A small piece of ownership in the company', 'A fixed monthly income', 'A promise of guaranteed profit'],
        correct: 1,
        explanation: 'Buying a share means you own a small percentage of that company. You become a part-owner!',
      },
      {
        id: 'q1-2',
        question: 'Which is India\'s LARGEST stock exchange?',
        options: ['BSE (Bombay Stock Exchange)', 'NSE (National Stock Exchange)', 'MCX (Multi Commodity Exchange)', 'CDSL'],
        correct: 1,
        explanation: 'NSE is India\'s largest stock exchange by trading volume, home to the famous NIFTY 50 index.',
      },
      {
        id: 'q1-3',
        question: 'If more people want to BUY a stock than SELL it, what happens to the price?',
        options: ['Price goes down', 'Price stays the same', 'Price goes up', 'Trading gets halted'],
        correct: 2,
        explanation: 'Basic economics! When demand exceeds supply, prices increase. More buyers = higher stock price.',
      },
      {
        id: 'q1-4',
        question: 'What does SEBI stand for?',
        options: ['Stock Exchange Board of India', 'Securities and Exchange Board of India', 'Stock Equity Bureau of India', 'Securities Exchange Bureau of India'],
        correct: 1,
        explanation: 'SEBI (Securities and Exchange Board of India) is the regulator that protects investors and ensures fair markets.',
      },
      {
        id: 'q1-5',
        question: 'SENSEX tracks the top stocks on which exchange?',
        options: ['NSE', 'BSE', 'MCX', 'CDSL'],
        correct: 1,
        explanation: 'SENSEX (Sensitive Index) is the benchmark index of BSE (Bombay Stock Exchange), tracking top 30 companies.',
      },
    ],
  },

  'lesson-2': {
    id: 'lesson-2',
    moduleId: 'module-1',
    title: 'Stocks vs Bonds: Choose Your Weapon',
    subtitle: 'Two mighty weapons in your investment arsenal',
    character: '⚔️',
    characterName: 'Grimbold the Giant',
    difficulty: 'beginner',
    xpReward: 50,
    duration: '8 min',
    content: `
<h2>Two Weapons of Wealth ⚔️🛡️</h2>
<p>Every adventurer needs the right weapons. In investing, your two main weapons are <strong>Stocks</strong> and <strong>Bonds</strong>. Let's compare them!</p>

<h3>Stocks: The Warrior's Sword</h3>
<p>Stocks represent <strong>ownership</strong> in a company. They're like a warrior's sword - powerful, potentially game-changing, but risky!</p>
<ul>
<li>🔺 <strong>High Potential Returns</strong> - Stocks have historically given 12-15% annual returns</li>
<li>🔴 <strong>Higher Risk</strong> - Prices can fall 50% in a crash</li>
<li>📈 <strong>Dividends</strong> - Some companies share profits with shareholders</li>
<li>✅ <strong>Ownership Rights</strong> - You can vote on company decisions</li>
</ul>

<div class="example-box">
<h4>⚔️ Sword Example</h4>
<p>If you invested ₹1 Lakh in TCS stock 10 years ago, it would be worth approximately ₹6-7 Lakhs today. Powerful, but it also dropped 40% during COVID!</p>
</div>

<h3>Bonds: The Shield of Safety</h3>
<p>Bonds are <strong>loans</strong> you give to companies or the government. They're like a shield - protective, reliable, but won't make you rich fast.</p>
<ul>
<li>✅ <strong>Fixed Returns</strong> - You get a promised interest rate (coupon)</li>
<li>🟢 <strong>Lower Risk</strong> - Government bonds are almost guaranteed</li>
<li>🔻 <strong>Lower Returns</strong> - Typically 6-8% annually</li>
<li>⏰ <strong>Maturity Date</strong> - You get your principal back at the end</li>
</ul>

<h3>The Smart Adventurer's Choice</h3>
<div class="tip-box">
<h4>🧙‍♀️ The Balance of Power</h4>
<p>Young adventurers (20s-30s) should hold more stocks (70-80%) for growth. As you age, shift more to bonds for safety. This is called <strong>Asset Allocation</strong>!</p>
</div>

<table>
<tr><th>Feature</th><th>Stocks ⚔️</th><th>Bonds 🛡️</th></tr>
<tr><td>Returns</td><td>12-15%</td><td>6-8%</td></tr>
<tr><td>Risk</td><td>High</td><td>Low</td></tr>
<tr><td>You are</td><td>Owner</td><td>Lender</td></tr>
<tr><td>Income</td><td>Dividends</td><td>Interest (Coupon)</td></tr>
</table>
    `,
    quiz: [
      {
        id: 'q2-1',
        question: 'When you buy a stock, you become a:',
        options: ['Lender to the company', 'Owner of the company', 'Customer of the company', 'Employee of the company'],
        correct: 1,
        explanation: 'Stocks represent ownership. When you buy stock, you\'re an owner (shareholder) of that company!',
      },
      {
        id: 'q2-2',
        question: 'Which investment instrument gives FIXED, PREDICTABLE returns?',
        options: ['Stocks', 'Mutual Funds', 'Bonds', 'Crypto'],
        correct: 2,
        explanation: 'Bonds pay a fixed interest rate (coupon) and return your principal at maturity, making them predictable.',
      },
      {
        id: 'q2-3',
        question: 'The regular income from bonds is called:',
        options: ['Dividend', 'Coupon', 'Royalty', 'Bonus'],
        correct: 1,
        explanation: 'Bond interest payments are called "coupons" - a term from the old days when bonds had physical coupons to clip!',
      },
      {
        id: 'q2-4',
        question: 'For a 25-year-old investor focused on GROWTH, which allocation is most suitable?',
        options: ['80% Bonds, 20% Stocks', '50% Bonds, 50% Stocks', '70% Stocks, 30% Bonds', '100% Bonds'],
        correct: 2,
        explanation: 'Young investors have time to ride out market volatility, so a higher stock allocation (70-80%) is recommended for long-term growth.',
      },
      {
        id: 'q2-5',
        question: 'A company shares a portion of its profits with stockholders. This is called:',
        options: ['Coupon', 'Dividend', 'Bonus Issue', 'Rights Issue'],
        correct: 1,
        explanation: 'When companies distribute profits to shareholders, it\'s called a Dividend. Some Indian companies pay 2-8% dividend yield!',
      },
    ],
  },

  'lesson-3': {
    id: 'lesson-3',
    moduleId: 'module-1',
    title: 'The Trading Castle: NSE & BSE Explained',
    subtitle: 'Understand how exchanges work',
    character: '🏰',
    characterName: 'Goblin the Trader',
    difficulty: 'beginner',
    xpReward: 75,
    duration: '9 min',
    content: `
<h2>Welcome to the Trading Castle! 🏰</h2>
<p>Stock exchanges are like grand castles where the magic of trading happens. Let's explore how they work!</p>

<h3>How Trading Actually Works</h3>
<p>When you place a "buy" order for Reliance stock at ₹2,500, you enter an order into the exchange's system. The exchange finds someone willing to sell at that price and <strong>matches</strong> the two orders. This happens in microseconds!</p>

<div class="example-box">
<h4>🏰 The Matching Engine</h4>
<p>The exchange's matching engine processes millions of orders per second. Think of it as the world's most powerful and fair matchmaking system for buyers and sellers.</p>
</div>

<h3>Key Participants</h3>
<ul>
<li>🏦 <strong>Brokers</strong> - Your gateway to the exchange (Zerodha, Groww, Upstox)</li>
<li>🏛️ <strong>Depositories</strong> - Hold your shares digitally (NSDL, CDSL)</li>
<li>📊 <strong>Market Makers</strong> - Ensure liquidity by always being ready to buy/sell</li>
<li>🏢 <strong>Institutional Investors</strong> - Mutual funds, FIIs, insurance companies</li>
<li>👤 <strong>Retail Investors</strong> - People like you and me!</li>
</ul>

<h3>Types of Orders</h3>
<ul>
<li>📌 <strong>Market Order</strong> - Buy/sell at the current best available price (instant but uncertain price)</li>
<li>🎯 <strong>Limit Order</strong> - Buy/sell at YOUR specified price or better (certain price but may not execute)</li>
<li>🛡️ <strong>Stop Loss Order</strong> - Automatically sells when price drops to a threshold (protects from big losses)</li>
</ul>

<h3>Trading Sessions</h3>
<p>Indian markets operate from <strong>9:15 AM to 3:30 PM</strong> on weekdays (Monday-Friday), except holidays. The pre-market session runs from 9:00-9:15 AM for price discovery.</p>

<div class="tip-box">
<h4>🧙‍♀️ Witch's Wisdom</h4>
<p>Your shares aren't stored in a paper certificate anymore. They're held digitally in a <strong>DEMAT account</strong> with NSDL or CDSL. Zerodha's Kite, Groww, and Upstox all connect to these depositories!</p>
</div>

<h3>Settlement Cycle</h3>
<p>When you buy shares, you don't get them instantly. India follows <strong>T+1 settlement</strong> - you get shares the NEXT trading day. Similarly, when you sell, money arrives the next day.</p>
    `,
    quiz: [
      {
        id: 'q3-1',
        question: 'What is the main role of a stock exchange like NSE/BSE?',
        options: ['To lend money to companies', 'To match buyers and sellers of stocks', 'To manage company accounts', 'To print money'],
        correct: 1,
        explanation: 'Stock exchanges are matchmakers! They connect buyers and sellers of stocks in a transparent, regulated environment.',
      },
      {
        id: 'q3-2',
        question: 'A Limit Order allows you to:',
        options: ['Buy at any current price', 'Set your desired buy/sell price', 'Only sell stocks', 'Trade after market hours'],
        correct: 1,
        explanation: 'Limit orders let you specify the exact price you want to buy or sell at. The order executes only at that price or better.',
      },
      {
        id: 'q3-3',
        question: 'Indian stock markets (NSE/BSE) trade on which days?',
        options: ['7 days a week', 'Monday to Saturday', 'Monday to Friday (weekdays)', 'Only weekends'],
        correct: 2,
        explanation: 'NSE and BSE operate Monday to Friday from 9:15 AM to 3:30 PM, except on market holidays.',
      },
      {
        id: 'q3-4',
        question: 'What does DEMAT account stand for?',
        options: ['Delivery and Market Account', 'Dematerialized Account', 'Deposit and Marketing Account', 'Direct Equity Market Account'],
        correct: 1,
        explanation: 'DEMAT (Dematerialized) account holds your shares in digital/electronic form, replacing physical paper certificates.',
      },
      {
        id: 'q3-5',
        question: 'Under T+1 settlement, when do you receive shares after buying?',
        options: ['Same day', 'Next trading day', 'After 2 trading days', 'After a week'],
        correct: 1,
        explanation: 'India moved to T+1 settlement in 2023. Shares arrive in your DEMAT account the next trading day after purchase.',
      },
    ],
  },

  'lesson-4': {
    id: 'lesson-4',
    moduleId: 'module-1',
    title: 'Bull Raiders vs Bear Bandits',
    subtitle: 'Master market cycles like a pro',
    character: '🐂',
    characterName: 'Thorin the Bull Rider',
    difficulty: 'beginner',
    xpReward: 75,
    duration: '8 min',
    content: `
<h2>The Great Battle: Bulls vs Bears! 🐂🐻</h2>
<p>Every market goes through cycles. Understanding these cycles is one of the most powerful weapons in an investor's arsenal!</p>

<h3>The Bull Market: When Raiders Rule</h3>
<p>A <strong>Bull Market</strong> is a period of rising stock prices - generally defined as a 20% or more increase from recent lows. Bulls attack by pushing their horns UPWARD, symbolizing rising prices!</p>

<div class="example-box">
<h4>🐂 Famous Bull Runs</h4>
<p>India's NIFTY 50 went from 2,500 (2009) to 25,000+ (2024) - a 10x return over 15 years! During bull markets, even average stocks double in value.</p>
</div>

<ul>
<li>✅ Economy is growing</li>
<li>✅ Company profits are rising</li>
<li>✅ Investors feel optimistic (FOMO is real!)</li>
<li>✅ High employment, low inflation</li>
</ul>

<h3>The Bear Market: When Bandits Strike</h3>
<p>A <strong>Bear Market</strong> is when prices fall 20% or more from recent highs. Bears attack by swiping their paws DOWNWARD, symbolizing falling prices!</p>

<ul>
<li>🔴 Economic slowdown or recession</li>
<li>🔴 Company profits declining</li>
<li>🔴 Fear and panic selling</li>
<li>🔴 High unemployment, high inflation</li>
</ul>

<div class="tip-box">
<h4>🧙‍♀️ The Wise Witch's Secret</h4>
<p>Warren Buffett's most famous quote: <em>"Be fearful when others are greedy, and greedy when others are fearful."</em> The BEST time to buy is during bear markets! 2008 crash, COVID crash 2020 - both were incredible buying opportunities.</p>
</div>

<h3>Market Sentiment Indicators</h3>
<ul>
<li>📊 <strong>VIX (Volatility Index)</strong> - High VIX = fear/bear market. Low VIX = calm/bull market</li>
<li>📰 <strong>News Cycle</strong> - Excessive positive news = be cautious (greed). Excessive panic = time to buy</li>
<li>💰 <strong>FII Activity</strong> - Foreign investors buying = bullish signal</li>
</ul>

<h3>Market Corrections - The Mini-Bear</h3>
<p>A <strong>correction</strong> is a 10-20% fall from peak. These are NORMAL and healthy! Markets typically correct every 1-2 years. Don't panic - corrections are buying opportunities for long-term investors.</p>
    `,
    quiz: [
      {
        id: 'q4-1',
        question: 'A Bull Market is officially defined as prices rising by how much from recent lows?',
        options: ['5% or more', '10% or more', '20% or more', '50% or more'],
        correct: 2,
        explanation: 'A bull market is technically defined as a 20%+ rise from recent lows. This signals a sustained upward trend.',
      },
      {
        id: 'q4-2',
        question: 'A market correction is typically defined as a price fall of:',
        options: ['2-5%', '10-20%', '20-50%', 'More than 50%'],
        correct: 1,
        explanation: 'A correction is a 10-20% pullback from recent highs. It\'s normal and healthy - markets correct regularly!',
      },
      {
        id: 'q4-3',
        question: 'What does HIGH VIX (Volatility Index) typically indicate?',
        options: ['Calm bull market', 'Fear and potential bear market', 'Strong economic growth', 'Low trading volume'],
        correct: 1,
        explanation: 'VIX is called the "fear gauge." High VIX indicates uncertainty and fear in the market, often seen during downturns.',
      },
      {
        id: 'q4-4',
        question: 'Warren Buffett advises to be greedy when others are:',
        options: ['Greedy', 'Fearful', 'Optimistic', 'Trading heavily'],
        correct: 1,
        explanation: 'Buffett\'s famous advice: Be fearful when others are greedy, and GREEDY when others are FEARFUL. Buy during panic!',
      },
      {
        id: 'q4-5',
        question: 'FII stands for:',
        options: ['Financial Investment Institute', 'Foreign Institutional Investor', 'Fixed Income Instrument', 'Federal Investment Index'],
        correct: 1,
        explanation: 'FII (Foreign Institutional Investor) refers to foreign entities (banks, funds) investing in Indian markets. Their activity heavily influences our markets.',
      },
    ],
  },

  'lesson-5': {
    id: 'lesson-5',
    moduleId: 'module-1',
    title: 'Reading the Runes: Stock Quotes',
    subtitle: 'Decode stock prices like a wizard',
    character: '📜',
    characterName: 'Seraphina the Witch',
    difficulty: 'intermediate',
    xpReward: 100,
    duration: '10 min',
    content: `
<h2>Decoding the Ancient Runes! 📜</h2>
<p>A stock quote is full of powerful information. Learning to read it is like learning an ancient language that tells you everything about a stock!</p>

<h3>A Real Stock Quote Decoded</h3>
<div class="example-box">
<h4>Example: Reliance Industries (NSE: RELIANCE)</h4>
<p>CMP: ₹2,650.40 | Change: +₹32.10 (+1.23%) | Open: ₹2,620 | High: ₹2,665 | Low: ₹2,610 | Volume: 12.5M | Market Cap: ₹17.9L Cr</p>
</div>

<h3>Key Terms in a Stock Quote</h3>
<ul>
<li>💰 <strong>CMP (Current Market Price)</strong> - The price right NOW. Changes every second during trading hours.</li>
<li>📊 <strong>52-Week High/Low</strong> - The highest and lowest price in the past year. Tells you where you stand in the range.</li>
<li>📦 <strong>Volume</strong> - Number of shares traded today. High volume = high interest (could be buying OR selling pressure).</li>
<li>🏢 <strong>Market Cap</strong> - Total value of all shares (Price × Total Shares). Reliance = ₹18 Lakh Crore!</li>
<li>💹 <strong>P/E Ratio</strong> - Price-to-Earnings ratio. How much you pay for ₹1 of company earnings (more on this later!).</li>
<li>📈 <strong>EPS (Earnings Per Share)</strong> - Company's profit divided by total shares. Higher = more profitable per share.</li>
</ul>

<h3>Upper Circuit & Lower Circuit</h3>
<p>To prevent extreme crashes/surges, SEBI sets limits on how much a stock can move in one day:</p>
<ul>
<li>🔴 <strong>Lower Circuit</strong> - Stock can't fall more than 5/10/20% in a day</li>
<li>🟢 <strong>Upper Circuit</strong> - Stock can't rise more than 5/10/20% in a day</li>
</ul>

<div class="tip-box">
<h4>🧙‍♀️ Witch's Warning</h4>
<p>Don't confuse 52-week high as "expensive" or 52-week low as "cheap." A stock at 52-week low might be there for good reasons (bad business). Always look at fundamentals, not just price!</p>
</div>

<h3>Large Cap, Mid Cap, Small Cap</h3>
<ul>
<li>🐉 <strong>Large Cap</strong> - Market cap above ₹20,000 Cr (Reliance, TCS, HDFC Bank) - Stable, lower risk</li>
<li>🐺 <strong>Mid Cap</strong> - ₹5,000 - ₹20,000 Cr - Moderate growth potential, moderate risk</li>
<li>🐀 <strong>Small Cap</strong> - Below ₹5,000 Cr - High growth potential, HIGH risk</li>
</ul>
    `,
    quiz: [
      {
        id: 'q5-1',
        question: 'CMP in a stock quote stands for:',
        options: ['Company Market Price', 'Current Market Price', 'Calculated Market Price', 'Cumulative Market Price'],
        correct: 1,
        explanation: 'CMP = Current Market Price. It\'s the real-time price at which the stock is currently trading.',
      },
      {
        id: 'q5-2',
        question: 'How is Market Capitalization calculated?',
        options: ['Total Revenue × Share Price', 'Share Price × Total Outstanding Shares', 'Annual Profit × P/E Ratio', 'Book Value × Price'],
        correct: 1,
        explanation: 'Market Cap = Current Share Price × Total Outstanding Shares. It represents the total market value of a company.',
      },
      {
        id: 'q5-3',
        question: 'What does HIGH VOLUME on a stock typically indicate?',
        options: ['The stock is definitely going up', 'High interest/activity (could be buying or selling)', 'Low liquidity', 'The stock is very expensive'],
        correct: 1,
        explanation: 'High volume means many shares are being traded - indicating strong interest. But this could be buyers OR sellers!',
      },
      {
        id: 'q5-4',
        question: 'A stock with Market Cap above ₹20,000 Crore is classified as:',
        options: ['Small Cap', 'Mid Cap', 'Large Cap', 'Mega Cap'],
        correct: 2,
        explanation: 'In India, SEBI classifies companies with Market Cap > ₹20,000 Cr as Large Cap stocks. These are typically stable, established companies.',
      },
      {
        id: 'q5-5',
        question: 'What is a "Lower Circuit" in the stock market?',
        options: ['A type of electrical fault', 'A limit on how much a stock can FALL in one day', 'A limit on how much a stock can RISE in one day', 'Trading halt for the entire market'],
        correct: 1,
        explanation: 'Lower Circuit is a price band limit preventing a stock from falling more than 5/10/20% in a single trading day.',
      },
    ],
  },

  'lesson-6': {
    id: 'lesson-6',
    moduleId: 'module-2',
    title: 'The Art of Company Reading',
    subtitle: 'Introduction to Fundamental Analysis',
    character: '🔮',
    characterName: 'Elvira the Oracle',
    difficulty: 'intermediate',
    xpReward: 100,
    duration: '10 min',
    content: `
<h2>The Art of Reading Companies 🔮</h2>
<p>Fundamental Analysis is the magical art of determining a company's TRUE VALUE by studying its financials, business model, and competitive position. It's the weapon of legendary investors like Warren Buffett!</p>

<h3>What is Fundamental Analysis?</h3>
<p>Instead of looking at charts (that's Technical Analysis), fundamental analysts ask: <strong>"Is this company actually a good business?"</strong> They study:</p>
<ul>
<li>📊 Financial statements (Balance Sheet, Income Statement, Cash Flow)</li>
<li>🏢 Business model and competitive advantages</li>
<li>👥 Management quality</li>
<li>📰 Industry trends and macro environment</li>
</ul>

<h3>The Two Types of Value</h3>
<div class="example-box">
<h4>Intrinsic Value vs Market Price</h4>
<p><strong>Intrinsic Value</strong> = What a company is TRULY WORTH based on its future earnings<br><strong>Market Price</strong> = What the market is CURRENTLY PAYING for it<br><br>If Intrinsic Value > Market Price → Stock is UNDERVALUED (BUY signal!)<br>If Market Price > Intrinsic Value → Stock is OVERVALUED (SELL signal!)</p>
</div>

<h3>Three Key Financial Statements</h3>
<ul>
<li>📋 <strong>Balance Sheet</strong> - Snapshot of assets, liabilities, and equity at a point in time ("What does the company OWN and OWE?")</li>
<li>💰 <strong>Income Statement (P&L)</strong> - Revenue and expenses over a period ("How much did it EARN?")</li>
<li>💵 <strong>Cash Flow Statement</strong> - Actual cash moving in and out ("How much CASH did it generate?")</li>
</ul>

<h3>Top-Down vs Bottom-Up</h3>
<ul>
<li>🌍 <strong>Top-Down</strong> - Start with macroeconomic trends → choose industry → pick best company</li>
<li>🔬 <strong>Bottom-Up</strong> - Find great individual companies regardless of market conditions</li>
</ul>

<div class="tip-box">
<h4>🔮 Oracle's Insight</h4>
<p>Fundamental Analysis works best for LONG-TERM investing (3-10+ years). In the short term, prices can be irrational. But over time, stock prices always converge to intrinsic value!</p>
</div>
    `,
    quiz: [
      {
        id: 'q6-1',
        question: 'Fundamental Analysis primarily focuses on:',
        options: ['Chart patterns and price movements', 'Company\'s financial health and true value', 'Short-term trading signals', 'Market sentiment and news'],
        correct: 1,
        explanation: 'Fundamental Analysis evaluates a company\'s intrinsic value through financial statements, business model, and competitive advantages.',
      },
      {
        id: 'q6-2',
        question: 'If a stock\'s Intrinsic Value is GREATER than its Market Price, the stock is:',
        options: ['Overvalued - avoid it', 'Fairly valued', 'Undervalued - potential buy', 'In a bear market'],
        correct: 2,
        explanation: 'When intrinsic value > market price, the stock is trading below its true worth - a potential buying opportunity!',
      },
      {
        id: 'q6-3',
        question: 'Which financial statement shows assets, liabilities, and equity?',
        options: ['Income Statement', 'Cash Flow Statement', 'Balance Sheet', 'Annual Report'],
        correct: 2,
        explanation: 'The Balance Sheet shows what a company owns (assets), owes (liabilities), and the difference (equity) at a specific point in time.',
      },
      {
        id: 'q6-4',
        question: 'A "Bottom-Up" investment approach means:',
        options: ['Investing in small-cap stocks only', 'Finding great companies regardless of market conditions', 'Starting with macro economy then picking stocks', 'Buying stocks at their lowest price'],
        correct: 1,
        explanation: 'Bottom-Up investing means you analyze individual companies on their own merit, regardless of broader market or economic conditions.',
      },
      {
        id: 'q6-5',
        question: 'Which statement shows CASH actually flowing in and out of the business?',
        options: ['Balance Sheet', 'Income Statement', 'Cash Flow Statement', 'Profit & Loss Account'],
        correct: 2,
        explanation: 'The Cash Flow Statement tracks actual cash movements. A company can show profit on paper but have negative cash flow!',
      },
    ],
  },

  'lesson-7': {
    id: 'lesson-7',
    moduleId: 'module-2',
    title: 'The Balance Sheet Scroll',
    subtitle: 'Unlock the secrets of company finances',
    character: '📜',
    characterName: 'Seraphina the Witch',
    difficulty: 'intermediate',
    xpReward: 125,
    duration: '12 min',
    content: `
<h2>The Ancient Balance Sheet Scroll 📜</h2>
<p>The Balance Sheet is the most fundamental document in finance. It follows one sacred equation: <strong>Assets = Liabilities + Equity</strong>. This ALWAYS balances!</p>

<h3>Assets: What the Company OWNS</h3>
<ul>
<li>🏭 <strong>Fixed Assets (Non-Current)</strong> - Land, buildings, machinery - things that last many years</li>
<li>💰 <strong>Current Assets</strong> - Cash, inventory, receivables - things convertible to cash within 1 year</li>
</ul>

<div class="example-box">
<h4>Example: TCS Balance Sheet (simplified)</h4>
<p>Total Assets: ₹85,000 Cr<br>- Fixed Assets (offices, computers): ₹25,000 Cr<br>- Current Assets (cash, receivables): ₹60,000 Cr</p>
</div>

<h3>Liabilities: What the Company OWES</h3>
<ul>
<li>🏦 <strong>Long-term Debt</strong> - Loans due after 1 year (bonds, bank loans)</li>
<li>⚡ <strong>Current Liabilities</strong> - Bills, short-term loans due within 1 year</li>
</ul>

<h3>Equity: The Owners' Share</h3>
<p>Equity = Assets - Liabilities. It's what belongs to shareholders AFTER paying all debts.</p>
<ul>
<li>💵 <strong>Share Capital</strong> - Original investment by shareholders</li>
<li>📈 <strong>Retained Earnings</strong> - Profits kept in the business over years</li>
</ul>

<h3>Key Balance Sheet Ratios</h3>
<ul>
<li>📊 <strong>Debt-to-Equity Ratio</strong> = Total Debt ÷ Equity. Lower is usually better! D/E > 2 can be risky.</li>
<li>💧 <strong>Current Ratio</strong> = Current Assets ÷ Current Liabilities. Above 1.5 means company can pay short-term bills.</li>
<li>📚 <strong>Book Value Per Share</strong> = Equity ÷ Total Shares. Compare to market price to gauge valuation.</li>
</ul>

<div class="tip-box">
<h4>🧙‍♀️ Warning: Debt is a Double-Edged Sword!</h4>
<p>Some debt is fine (it can fuel growth). But too much debt = dangerous. Companies like IL&FS and DHFL collapsed because of excessive debt! Always check the Debt-to-Equity ratio!</p>
</div>
    `,
    quiz: [
      {
        id: 'q7-1',
        question: 'The fundamental accounting equation is:',
        options: ['Revenue - Expenses = Profit', 'Assets = Liabilities + Equity', 'Cash + Debt = Market Cap', 'Profit = Revenue × Margin'],
        correct: 1,
        explanation: 'Assets = Liabilities + Equity is the golden accounting equation. It always balances! This is the foundation of double-entry bookkeeping.',
      },
      {
        id: 'q7-2',
        question: 'Which of these is a CURRENT ASSET?',
        options: ['Company headquarters building', 'Manufacturing machinery', 'Cash and bank balances', 'Long-term investments'],
        correct: 2,
        explanation: 'Current assets are convertible to cash within 1 year. Cash and bank balances are the most liquid current assets.',
      },
      {
        id: 'q7-3',
        question: 'Debt-to-Equity ratio of 0.3 compared to 2.5 indicates:',
        options: ['0.3 is more risky', '2.5 is less risky', '0.3 uses much less debt (less risky)', 'They are the same risk'],
        correct: 2,
        explanation: 'Lower D/E ratio = less financial leverage. D/E of 0.3 means the company has very little debt relative to equity - much safer!',
      },
      {
        id: 'q7-4',
        question: 'Retained Earnings in a balance sheet represents:',
        options: ['Cash kept in a bank locker', 'Profits accumulated and reinvested in the business over years', 'Money raised from new share issuance', 'Dividends yet to be paid'],
        correct: 1,
        explanation: 'Retained Earnings are cumulative profits that weren\'t paid as dividends but reinvested into the business to fund growth.',
      },
      {
        id: 'q7-5',
        question: 'A Current Ratio of 0.7 means:',
        options: ['The company is highly profitable', 'The company may struggle to pay short-term obligations', 'The company has no debt', 'The stock is undervalued'],
        correct: 1,
        explanation: 'Current Ratio < 1 means current liabilities exceed current assets - the company might struggle to pay its short-term bills!',
      },
    ],
  },

  'lesson-8': {
    id: 'lesson-8',
    moduleId: 'module-2',
    title: 'The P/E Prophecy',
    subtitle: 'Master the most important valuation metric',
    character: '🔮',
    characterName: 'Elvira the Oracle',
    difficulty: 'intermediate',
    xpReward: 125,
    duration: '11 min',
    content: `
<h2>The P/E Prophecy 🔮</h2>
<p>The Price-to-Earnings (P/E) ratio is the most widely used valuation metric in stock markets. Master it and you'll have a superpower others lack!</p>

<h3>What is P/E Ratio?</h3>
<p><strong>P/E = Market Price Per Share ÷ Earnings Per Share (EPS)</strong></p>
<p>In simple terms: How many rupees are you paying for every ₹1 of company earnings?</p>

<div class="example-box">
<h4>🔮 Real Example: HDFC Bank</h4>
<p>Share Price: ₹1,600<br>EPS (Annual Profit per Share): ₹80<br>P/E Ratio = 1600 ÷ 80 = <strong>20</strong><br><br>This means: You're paying ₹20 for every ₹1 of HDFC Bank's annual earnings. Or it'll take 20 years to "recover" your investment through earnings alone.</p>
</div>

<h3>High P/E vs Low P/E</h3>
<ul>
<li>📈 <strong>High P/E (30-100+)</strong> - Market expects HIGH GROWTH. Investors pay premium for future potential. (Example: Growth tech stocks)</li>
<li>📉 <strong>Low P/E (5-15)</strong> - Market expects SLOWER GROWTH or there's uncertainty. Could be undervalued... or a value trap!</li>
<li>📊 <strong>Negative P/E</strong> - Company is making LOSSES. Avoid unless you understand the turnaround story.</li>
</ul>

<h3>Industry-Relative P/E</h3>
<p>CRUCIAL: Always compare P/E within the SAME industry! Banking sector avg P/E is ~15. IT sector avg is ~25. Comparing HDFC Bank's P/E to Infosys is meaningless!</p>

<div class="tip-box">
<h4>🧙‍♀️ The P/E Trap Warning</h4>
<p>Never buy a stock JUST because P/E is low! It might be low because:<br>• Business is declining<br>• Management is corrupt<br>• Industry is dying<br>Always combine P/E with qualitative analysis!</p>
</div>

<h3>Related Metrics</h3>
<ul>
<li>📊 <strong>Forward P/E</strong> - Uses EXPECTED future earnings (more useful for growth stocks)</li>
<li>📈 <strong>PEG Ratio</strong> = P/E ÷ Earnings Growth Rate. PEG < 1 is considered undervalued!</li>
<li>📉 <strong>P/B Ratio</strong> = Price ÷ Book Value. Good for banks and asset-heavy companies.</li>
</ul>
    `,
    quiz: [
      {
        id: 'q8-1',
        question: 'P/E ratio formula is:',
        options: ['Profit ÷ Equity', 'Price Per Share ÷ Earnings Per Share', 'Price × Earnings', 'Equity ÷ Market Price'],
        correct: 1,
        explanation: 'P/E = Market Price Per Share ÷ EPS. It tells you how much you pay per rupee of earnings.',
      },
      {
        id: 'q8-2',
        question: 'A stock with P/E of 80 compared to industry average of 20 suggests:',
        options: ['The stock is very cheap', 'The market expects very high growth from this stock', 'The company is making huge losses', 'It\'s a banking stock'],
        correct: 1,
        explanation: 'A P/E much higher than industry average signals high growth expectations. Investors are paying a premium for anticipated future earnings growth.',
      },
      {
        id: 'q8-3',
        question: 'Negative P/E ratio means:',
        options: ['Stock is extremely undervalued', 'Company is making losses', 'Very high growth expected', 'Stock price is falling'],
        correct: 1,
        explanation: 'Negative P/E means the company has negative earnings (losses). EPS is negative, making the P/E calculation negative.',
      },
      {
        id: 'q8-4',
        question: 'PEG ratio (P/E to Growth) below 1 typically indicates:',
        options: ['Stock is overvalued', 'Stock may be undervalued relative to growth', 'No earnings growth', 'Company is losing money'],
        correct: 1,
        explanation: 'PEG = P/E ÷ Growth Rate. PEG < 1 suggests you\'re getting growth at a reasonable price - Peter Lynch\'s favorite metric!',
      },
      {
        id: 'q8-5',
        question: 'Why should P/E ratio be compared within the SAME industry?',
        options: ['Because regulations vary', 'Because different industries have different growth profiles and risk levels', 'Because all industries have the same P/E', 'It doesn\'t matter - compare with any industry'],
        correct: 1,
        explanation: 'P/E norms vary by industry. IT sector avg ~25, Banking ~15, FMCG ~40+. Comparing across industries gives misleading results!',
      },
    ],
  },

  'lesson-9': {
    id: 'lesson-9',
    moduleId: 'module-2',
    title: 'Revenue vs Profit Alchemy',
    subtitle: 'Transform income statement data into insights',
    character: '⚗️',
    characterName: 'Goblin the Trader',
    difficulty: 'intermediate',
    xpReward: 150,
    duration: '10 min',
    content: `
<h2>Revenue vs Profit Alchemy ⚗️</h2>
<p>"Revenue is vanity, Profit is sanity, Cash is reality." - This ancient investing mantra captures everything about the Income Statement!</p>

<h3>The Income Statement Journey</h3>
<p>Revenue flows down through various deductions to become profit. Each stage tells a different story:</p>
<ul>
<li>💰 <strong>Revenue (Turnover)</strong> - Total money earned from selling products/services</li>
<li>➖ <strong>COGS (Cost of Goods Sold)</strong> - Direct costs to produce what was sold</li>
<li>= <strong>Gross Profit</strong> - Revenue - COGS. Shows production efficiency.</li>
<li>➖ <strong>Operating Expenses</strong> - Salaries, rent, marketing, R&D</li>
<li>= <strong>EBITDA</strong> - Earnings Before Interest, Tax, Depreciation, Amortization</li>
<li>➖ <strong>Interest + Tax + Depreciation</strong></li>
<li>= <strong>Net Profit (PAT)</strong> - Final bottom-line profit for shareholders!</li>
</ul>

<div class="example-box">
<h4>⚗️ Alchemy Example: Hindustan Unilever</h4>
<p>Revenue: ₹60,000 Cr<br>COGS: ₹30,000 Cr<br>Gross Profit: ₹30,000 Cr (50% Gross Margin)<br>Operating Expenses: ₹12,000 Cr<br>EBITDA: ₹18,000 Cr (30% EBITDA Margin)<br>Net Profit: ₹10,000 Cr (16.7% Net Margin)</p>
</div>

<h3>Key Profit Margins</h3>
<ul>
<li>📊 <strong>Gross Margin</strong> = Gross Profit ÷ Revenue. Higher = better pricing power</li>
<li>💵 <strong>EBITDA Margin</strong> = EBITDA ÷ Revenue. Operational efficiency indicator</li>
<li>🎯 <strong>Net Profit Margin</strong> = Net Profit ÷ Revenue. The ultimate bottom line</li>
</ul>

<div class="tip-box">
<h4>🧙‍♀️ Revenue Trap Warning!</h4>
<p>A company growing revenue 30% per year but losing money isn't necessarily good! Many e-commerce companies in India (like some food delivery apps) had massive revenue but terrible losses. Always look at profitability trends!</p>
</div>
    `,
    quiz: [
      {
        id: 'q9-1',
        question: 'Revenue minus Cost of Goods Sold equals:',
        options: ['Net Profit', 'EBITDA', 'Gross Profit', 'Operating Profit'],
        correct: 2,
        explanation: 'Gross Profit = Revenue - COGS. It shows how efficiently the company produces its products before overhead costs.',
      },
      {
        id: 'q9-2',
        question: 'EBITDA stands for:',
        options: ['Earnings Before Income Tax and Dividends Accumulated', 'Earnings Before Interest, Tax, Depreciation, and Amortization', 'Equity Balance Including Tax, Depreciation and Assets', 'Earnings Based on Investment Tax and Debt Assessment'],
        correct: 1,
        explanation: 'EBITDA = Earnings Before Interest, Tax, Depreciation & Amortization. It measures core operational profitability.',
      },
      {
        id: 'q9-3',
        question: 'Net Profit Margin of 25% means:',
        options: ['Company spends 25% on taxes', 'For every ₹100 of revenue, company keeps ₹25 as net profit', 'Company\'s stock grows 25% per year', '25% of revenue goes to shareholders as dividend'],
        correct: 1,
        explanation: 'Net Profit Margin = Net Profit ÷ Revenue × 100. 25% means ₹25 profit for every ₹100 in sales after all expenses and taxes.',
      },
      {
        id: 'q9-4',
        question: 'A company has ₹1000 Cr revenue and ₹10 Cr net profit. Net margin is:',
        options: ['10%', '1%', '100%', '0.1%'],
        correct: 1,
        explanation: 'Net Margin = (10 ÷ 1000) × 100 = 1%. This is quite low - only ₹1 of profit per ₹100 of revenue!',
      },
      {
        id: 'q9-5',
        question: 'High Gross Margin typically indicates:',
        options: ['Company is in debt', 'Strong pricing power or low production costs', 'Company has high taxes', 'Revenue is declining'],
        correct: 1,
        explanation: 'High Gross Margin shows the company has strong pricing power or efficient production. Companies like IT and Pharma typically have high gross margins!',
      },
    ],
  },

  'lesson-10': {
    id: 'lesson-10',
    moduleId: 'module-2',
    title: 'Market Cap: Size of the Dragon',
    subtitle: 'Understand what market cap really means',
    character: '🐉',
    characterName: 'Grimbold the Giant',
    difficulty: 'intermediate',
    xpReward: 150,
    duration: '9 min',
    content: `
<h2>The Dragon's True Size: Market Cap 🐉</h2>
<p>Market Capitalization tells you the TOTAL MARKET VALUE of a company. It's the most important size metric in investing!</p>

<h3>Market Cap Formula</h3>
<p><strong>Market Cap = Current Share Price × Total Outstanding Shares</strong></p>

<div class="example-box">
<h4>🐉 Reliance Industries</h4>
<p>Share Price: ₹2,650<br>Total Shares: 676 Crore<br>Market Cap = ₹2,650 × 676 Cr = <strong>₹17.9 Lakh Crore</strong><br>This makes Reliance India's most valuable company!</p>
</div>

<h3>Market Cap Categories (India)</h3>
<ul>
<li>🐉 <strong>Large Cap</strong> - Top 100 companies by market cap. Above ₹20,000 Cr. (Reliance, TCS, Infosys)</li>
<li>🐺 <strong>Mid Cap</strong> - 101st to 250th companies. ₹5,000 - ₹20,000 Cr.</li>
<li>🐀 <strong>Small Cap</strong> - 251st onwards. Below ₹5,000 Cr.</li>
<li>🦟 <strong>Micro Cap</strong> - Below ₹1,000 Cr. Very high risk!</li>
</ul>

<h3>Why Market Cap Matters</h3>
<ul>
<li>📊 Determines NIFTY 50 / SENSEX inclusion (only large caps)</li>
<li>🔢 Index weight = higher market cap = more index influence</li>
<li>⚖️ Valuation comparison - is this company cheap or expensive relative to others?</li>
</ul>

<div class="tip-box">
<h4>🧙‍♀️ Enterprise Value vs Market Cap</h4>
<p>Market Cap ignores debt! <strong>Enterprise Value = Market Cap + Total Debt - Cash</strong>. This is the TRUE takeover price of a company. A company with ₹100 Cr market cap but ₹200 Cr debt actually costs ₹300 Cr to acquire!</p>
</div>

<h3>Free Float Market Cap</h3>
<p>Promoters often hold large stakes and don't trade their shares. <strong>Free Float Market Cap</strong> only counts publicly tradeable shares. NIFTY 50 uses free float market cap for weightage calculation!</p>
    `,
    quiz: [
      {
        id: 'q10-1',
        question: 'A company has 10 Crore shares and each trades at ₹500. What is Market Cap?',
        options: ['₹500 Crore', '₹5,000 Crore', '₹50 Crore', '₹50,000 Crore'],
        correct: 1,
        explanation: 'Market Cap = 10 Cr shares × ₹500 = ₹5,000 Crore. This would be a Mid-Cap company in India!',
      },
      {
        id: 'q10-2',
        question: 'Enterprise Value formula is:',
        options: ['Market Cap + Revenue', 'Market Cap + Total Debt - Cash', 'Share Price × Earnings', 'Assets - Liabilities'],
        correct: 1,
        explanation: 'EV = Market Cap + Total Debt - Cash & Equivalents. It represents the theoretical takeover cost of the entire company.',
      },
      {
        id: 'q10-3',
        question: 'Which stocks are included in NIFTY 50?',
        options: ['Any 50 profitable companies', 'Top 50 Large Cap companies by free float market cap', 'Top 50 companies by revenue', 'Companies with P/E below 20'],
        correct: 1,
        explanation: 'NIFTY 50 comprises the top 50 Indian companies by free float market capitalization, representing approximately 13 sectors.',
      },
      {
        id: 'q10-4',
        question: 'Free Float Market Cap is different from regular Market Cap because it:',
        options: ['Uses yesterday\'s price', 'Only counts shares available for public trading (excludes promoter holdings)', 'Includes company debt', 'Is calculated monthly'],
        correct: 1,
        explanation: 'Free Float excludes locked-in promoter shares. Only shares available for public trading are counted, giving a more accurate tradeable market value.',
      },
      {
        id: 'q10-5',
        question: 'A large market cap company having lower P/E than a smaller cap company necessarily means:',
        options: ['Large cap is always better to buy', 'Large cap is undervalued', 'Nothing by itself - context and growth rates matter', 'Large cap has better management'],
        correct: 2,
        explanation: 'P/E comparison alone is insufficient. Large caps typically have lower growth rates, so lower P/E is expected. Context, growth rates, and industry matter!',
      },
    ],
  },
};

export const BADGES = [
  { id: 'first-quest', name: 'First Quest', description: 'Complete your first lesson', icon: '⚔️', xpRequired: 0, lessonsRequired: 1 },
  { id: 'market-apprentice', name: 'Market Apprentice', description: 'Complete all Module 1 lessons', icon: '🏰', xpRequired: 350, lessonsRequired: 5 },
  { id: 'quiz-master', name: 'Quiz Master', description: 'Score 100% on any quiz', icon: '🎯', xpRequired: 0, lessonsRequired: 0 },
  { id: 'streak-warrior', name: 'Streak Warrior', description: 'Maintain a 3-day streak', icon: '🔥', xpRequired: 0, lessonsRequired: 0 },
  { id: 'knowledge-seeker', name: 'Knowledge Seeker', description: 'Reach Level 3', icon: '🔮', xpRequired: 1250, lessonsRequired: 0 },
  { id: 'fundamental-sage', name: 'Fundamental Sage', description: 'Complete all Module 2 lessons', icon: '📜', xpRequired: 0, lessonsRequired: 10 },
];

export const LEVEL_NAMES = [
  { level: 1, name: 'Goblin Scout', icon: '👺', minXP: 0 },
  { level: 2, name: 'Apprentice Trader', icon: '🧝', minXP: 500 },
  { level: 3, name: 'Market Knight', icon: '⚔️', minXP: 1250 },
  { level: 4, name: 'Stock Wizard', icon: '🧙', minXP: 2500 },
  { level: 5, name: 'Investment Dragon', icon: '🐉', minXP: 5000 },
  { level: 6, name: 'Market Legend', icon: '👑', minXP: 10000 },
];

export function getLevel(xp) {
  for (let i = LEVEL_NAMES.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_NAMES[i].minXP) return LEVEL_NAMES[i];
  }
  return LEVEL_NAMES[0];
}

export function getNextLevel(xp) {
  const current = getLevel(xp);
  const next = LEVEL_NAMES.find(l => l.level === current.level + 1);
  return next || null;
}

export function getLevelProgress(xp) {
  const current = getLevel(xp);
  const next = getNextLevel(xp);
  if (!next) return 100;
  const progress = ((xp - current.minXP) / (next.minXP - current.minXP)) * 100;
  return Math.min(100, Math.max(0, progress));
}
