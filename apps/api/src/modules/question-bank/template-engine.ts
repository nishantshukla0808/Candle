/**
 * Template engine — docs/05 §2.4 (Question Bank scale engine).
 *
 * Pure functions, no I/O: a template + a seed deterministically produce
 * one question variant. Every variant is validated (computable answer,
 * plausible distinct distractors, sane numbers) before it can be created
 * — the service refuses to persist an invalid variant.
 *
 * Two working templates (seeded as DRAFT in prisma/question-bank-seed.ts):
 *  - tpl-compounding: "You invest ₹{principal} at {rate}% per year.
 *    After {years} years, about how much do you have, ignoring tax?"
 *  - tpl-budgeting-503020: 50/30/20 split of a randomised monthly income.
 *
 * Four Phase 4 templates (also seeded as DRAFT):
 *  - tpl-simple-vs-compound: how much MORE compounding gives than simple
 *    interest over the same years (compounding topic).
 *  - tpl-sip-goal: monthly SIP needed to reach a goal in N months,
 *    ignoring returns (mutual-funds topic).
 *  - tpl-emergency-fund: emergency-fund size = monthly essentials × months
 *    (banking-saving topic).
 *  - tpl-tax-slab: tax on income above a ₹3,00,000 tax-free limit at a
 *    single simplified rate (tax-basics topic).
 *
 * Money is formatted as whole rupees (₹12,345). Compounding answers are
 * rounded to the nearest ₹100 ("about how much") so the correct answer
 * is unambiguous and the simple-interest distractor stays distinct.
 */

export interface TemplateVariantOption {
  text: string;
  isCorrect: boolean;
}

export interface TemplateVariant {
  templateKey: string;
  stem: string;
  explanation: string;
  /** The parameter values this variant was generated from (stored on the item). */
  parameters: Record<string, number>;
  options: TemplateVariantOption[];
}

/** Parameter domains, matching the seeded template rows. */
export const COMPOUNDING_PRINCIPALS = [10000, 25000, 50000] as const;
export const COMPOUNDING_RATES = [6, 8, 10, 12] as const;
export const COMPOUNDING_YEARS = [3, 5, 10] as const;
export const BUDGETING_INCOMES = [30000, 40000, 50000, 60000, 80000] as const;
/** Simple-vs-compound: principals/rates/years chosen so the difference is
 *  always at least ₹400 (small differences would round to ₹0). */
export const SIMPLE_VS_COMPOUND_PRINCIPALS = [20000, 50000, 100000] as const;
export const SIMPLE_VS_COMPOUND_RATES = [8, 10, 12] as const;
export const SIMPLE_VS_COMPOUND_YEARS = [3, 5, 10] as const;
export const SIP_GOALS = [60000, 120000, 180000, 240000, 300000, 360000] as const;
export const SIP_MONTHS = [12, 24, 36, 48, 60] as const;
export const EMERGENCY_EXPENSES = [15000, 20000, 25000, 30000, 40000, 50000] as const;
export const EMERGENCY_MONTHS = [3, 4, 5, 6] as const;
export const TAX_INCOMES = [
  400000, 500000, 600000, 700000, 800000, 900000, 1000000, 1200000,
] as const;
export const TAX_RATES = [5, 10, 15, 20] as const;
export const TAX_FREE_LIMIT = 300000;

export const TEMPLATE_KEYS = [
  'tpl-compounding',
  'tpl-budgeting-503020',
  'tpl-simple-vs-compound',
  'tpl-sip-goal',
  'tpl-emergency-fund',
  'tpl-tax-slab',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Deterministic PRNG (mulberry32) so a seed always replays the same variant. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function round100(n: number): number {
  return Math.round(n / 100) * 100;
}

export function formatInr(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function pick<T>(rng: () => number, values: readonly T[]): T {
  const v = values[Math.floor(rng() * values.length)];
  if (v === undefined) throw new Error('Template domain is empty.');
  return v;
}

/** Fisher–Yates shuffle driven by the seeded rng (deterministic per seed). */
function shuffle<T>(rng: () => number, items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

function toOptions(
  rng: () => number,
  correctText: string,
  distractorTexts: string[]
): TemplateVariantOption[] {
  const options: TemplateVariantOption[] = [
    { text: correctText, isCorrect: true },
    ...distractorTexts.map((text) => ({ text, isCorrect: false })),
  ];
  return shuffle(rng, options);
}

/**
 * Compounding variant (doc 05 §2.4 example).
 * Correct = principal × (1 + rate)^years, rounded to the nearest ₹100.
 * Distractors = simple-interest answer, no-growth answer, and the
 * one-year-less compounding answer — all rounded the same way.
 */
export function generateCompounding(seed: number): TemplateVariant {
  const rng = seededRng(seed);
  const principal = pick(rng, COMPOUNDING_PRINCIPALS);
  const rate = pick(rng, COMPOUNDING_RATES);
  const years = pick(rng, COMPOUNDING_YEARS);
  const correct = round100(principal * (1 + rate / 100) ** years);
  const simple = round100(principal * (1 + (rate / 100) * years));
  const noGrowth = principal;
  const oneYearLess = round100(principal * (1 + rate / 100) ** (years - 1));
  const parameters = { principal, rate, years };
  const variant: TemplateVariant = {
    templateKey: 'tpl-compounding',
    stem:
      `You invest ${formatInr(principal)} at ${rate}% per year. ` +
      `After ${years} years, about how much do you have, ignoring tax?`,
    explanation:
      `After ${years} years at ${rate}%, ${formatInr(principal)} grows to about ` +
      `${formatInr(correct)}. Each year earns interest on the last year’s total, ` +
      `not just on the original amount.`,
    parameters,
    options: toOptions(rng, formatInr(correct), [
      formatInr(simple),
      formatInr(noGrowth),
      formatInr(oneYearLess),
    ]),
  };
  validateVariant(variant);
  return variant;
}

/**
 * Budgeting 50/30/20 variant. Correct = 20% of the monthly income.
 * Distractors = the wants share (30%), the needs share (50%), and half
 * the savings share (10%) — each a plausible slip, each distinct.
 */
export function generateBudgeting(seed: number): TemplateVariant {
  const rng = seededRng(seed);
  const income = pick(rng, BUDGETING_INCOMES);
  const savings = Math.round(income * 0.2);
  const parameters = { income };
  const variant: TemplateVariant = {
    templateKey: 'tpl-budgeting-503020',
    stem:
      `Asha earns ${formatInr(income)} a month and follows the 50/30/20 rule. ` +
      `How much should go to savings each month?`,
    explanation:
      `In the 50/30/20 rule, 20% of income goes to savings. ` +
      `20% of ${formatInr(income)} is ${formatInr(savings)}.`,
    parameters,
    options: toOptions(rng, formatInr(savings), [
      formatInr(income * 0.3),
      formatInr(income * 0.5),
      formatInr(income * 0.1),
    ]),
  };
  validateVariant(variant);
  return variant;
}

/**
 * Simple-vs-compound variant. Correct = compound total − simple total
 * (both rounded to the nearest ₹100 first, so the explanation's numbers
 * match the answer). Distractors = "₹0 — they are the same" (the classic
 * misconception), double the difference, half the difference.
 */
export function generateSimpleVsCompound(seed: number): TemplateVariant {
  const rng = seededRng(seed);
  const principal = pick(rng, SIMPLE_VS_COMPOUND_PRINCIPALS);
  const rate = pick(rng, SIMPLE_VS_COMPOUND_RATES);
  const years = pick(rng, SIMPLE_VS_COMPOUND_YEARS);
  const compound = round100(principal * (1 + rate / 100) ** years);
  const simple = round100(principal * (1 + (rate / 100) * years));
  const diff = compound - simple;
  const parameters = { principal, rate, years };
  const variant: TemplateVariant = {
    templateKey: 'tpl-simple-vs-compound',
    stem:
      `You invest ${formatInr(principal)} at ${rate}% per year for ${years} years. ` +
      `How much more do you get with compound interest than with simple interest, ignoring tax?`,
    explanation:
      `With simple interest you get ${formatInr(simple)}. ` +
      `With compounding you get about ${formatInr(compound)}. ` +
      `The difference is about ${formatInr(diff)}.`,
    parameters,
    options: toOptions(rng, formatInr(diff), [
      '₹0 — simple and compound give the same total',
      formatInr(round100(diff * 2)),
      formatInr(round100(diff / 2)),
    ]),
  };
  validateVariant(variant);
  return variant;
}

/**
 * SIP goal variant. Correct = goal ÷ months, rounded to the nearest ₹100
 * ("about how much", ignoring returns). Distractors = double the monthly
 * amount, half the monthly amount, and goal ÷ 10 (a "divide by 10" slip).
 */
export function generateSipGoal(seed: number): TemplateVariant {
  const rng = seededRng(seed);
  const goal = pick(rng, SIP_GOALS);
  const months = pick(rng, SIP_MONTHS);
  const monthlyRaw = goal / months;
  const monthly = round100(monthlyRaw);
  const parameters = { goal, months };
  const variant: TemplateVariant = {
    templateKey: 'tpl-sip-goal',
    stem:
      `You want ${formatInr(goal)} in ${months} months through a monthly SIP. ` +
      `Ignoring returns, about how much must you invest each month?`,
    explanation:
      `${formatInr(goal)} over ${months} months means about ${formatInr(monthly)} a month. ` +
      `Returns would change the real answer, but this is the plain saving amount.`,
    parameters,
    options: toOptions(rng, formatInr(monthly), [
      formatInr(round100(monthlyRaw * 2)),
      formatInr(round100(monthlyRaw / 2)),
      formatInr(round100(goal / 10)),
    ]),
  };
  validateVariant(variant);
  return variant;
}

/**
 * Emergency-fund variant. Correct = monthly essentials × months (exact —
 * no rounding needed). Distractors = one month of spending, one year of
 * spending, and three extra months of spending.
 */
export function generateEmergencyFund(seed: number): TemplateVariant {
  const rng = seededRng(seed);
  const monthlyExpenses = pick(rng, EMERGENCY_EXPENSES);
  const months = pick(rng, EMERGENCY_MONTHS);
  const fund = monthlyExpenses * months;
  const parameters = { monthlyExpenses, months };
  const variant: TemplateVariant = {
    templateKey: 'tpl-emergency-fund',
    stem:
      `Your essential spending is ${formatInr(monthlyExpenses)} a month. ` +
      `How big should your emergency fund be to cover ${months} months?`,
    explanation:
      `An emergency fund covers ${months} months of essentials. ` +
      `${months} × ${formatInr(monthlyExpenses)} = ${formatInr(fund)}.`,
    parameters,
    options: toOptions(rng, formatInr(fund), [
      formatInr(monthlyExpenses),
      formatInr(monthlyExpenses * 12),
      formatInr(monthlyExpenses * (months + 3)),
    ]),
  };
  validateVariant(variant);
  return variant;
}

/**
 * Tax-slab variant (simplified single-rate example — the stem says so).
 * Correct = (income − ₹3,00,000 tax-free limit) × rate. Distractors =
 * tax on the FULL income, tax computed with only ₹1,00,000 treated as
 * free (a smaller exemption), and half the correct tax.
 */
export function generateTaxSlab(seed: number): TemplateVariant {
  const rng = seededRng(seed);
  const income = pick(rng, TAX_INCOMES);
  const rate = pick(rng, TAX_RATES);
  const taxable = income - TAX_FREE_LIMIT;
  const tax = (taxable * rate) / 100;
  const parameters = { income, rate };
  const variant: TemplateVariant = {
    templateKey: 'tpl-tax-slab',
    stem:
      `In this simplified example, the first ₹3,00,000 of income is tax-free ` +
      `and the rest is taxed at ${rate}%. Your income is ${formatInr(income)}. ` +
      `How much tax do you pay?`,
    explanation:
      `Only ${formatInr(taxable)} is taxed, because the first ₹3,00,000 is free. ` +
      `${rate}% of ${formatInr(taxable)} is ${formatInr(tax)}.`,
    parameters,
    options: toOptions(rng, formatInr(tax), [
      formatInr((income * rate) / 100),
      formatInr(((income - 100000) * rate) / 100),
      formatInr(tax / 2),
    ]),
  };
  validateVariant(variant);
  return variant;
}

/**
 * Validates a generated variant before it may be created: a non-empty
 * stem, exactly 4 options, exactly 1 correct, all option texts distinct,
 * and parameters inside their domains. Throws on the first failure.
 */
export function validateVariant(variant: TemplateVariant): void {
  if (!variant.stem.trim()) throw new Error('Template variant has an empty stem.');
  if (!variant.explanation.trim()) throw new Error('Template variant has an empty explanation.');
  if (variant.options.length !== 4) {
    throw new Error(`Template variant must have exactly 4 options, got ${variant.options.length}.`);
  }
  const correct = variant.options.filter((o) => o.isCorrect);
  if (correct.length !== 1) {
    throw new Error(`Template variant must have exactly 1 correct option, got ${correct.length}.`);
  }
  const texts = new Set(variant.options.map((o) => o.text));
  if (texts.size !== variant.options.length) {
    throw new Error('Template variant options must all be distinct.');
  }
  if (variant.templateKey === 'tpl-compounding') {
    const { principal, rate, years } = variant.parameters;
    if (
      principal === undefined ||
      !COMPOUNDING_PRINCIPALS.includes(principal as (typeof COMPOUNDING_PRINCIPALS)[number]) ||
      rate === undefined ||
      !COMPOUNDING_RATES.includes(rate as (typeof COMPOUNDING_RATES)[number]) ||
      years === undefined ||
      !COMPOUNDING_YEARS.includes(years as (typeof COMPOUNDING_YEARS)[number])
    ) {
      throw new Error('Compounding variant parameters are outside their domains.');
    }
  }
  if (variant.templateKey === 'tpl-budgeting-503020') {
    const { income } = variant.parameters;
    if (
      income === undefined ||
      !BUDGETING_INCOMES.includes(income as (typeof BUDGETING_INCOMES)[number])
    ) {
      throw new Error('Budgeting variant income is outside its domain.');
    }
  }
  if (variant.templateKey === 'tpl-simple-vs-compound') {
    const { principal, rate, years } = variant.parameters;
    if (
      principal === undefined ||
      !SIMPLE_VS_COMPOUND_PRINCIPALS.includes(
        principal as (typeof SIMPLE_VS_COMPOUND_PRINCIPALS)[number]
      ) ||
      rate === undefined ||
      !SIMPLE_VS_COMPOUND_RATES.includes(rate as (typeof SIMPLE_VS_COMPOUND_RATES)[number]) ||
      years === undefined ||
      !SIMPLE_VS_COMPOUND_YEARS.includes(years as (typeof SIMPLE_VS_COMPOUND_YEARS)[number])
    ) {
      throw new Error('Simple-vs-compound variant parameters are outside their domains.');
    }
  }
  if (variant.templateKey === 'tpl-sip-goal') {
    const { goal, months } = variant.parameters;
    if (
      goal === undefined ||
      !SIP_GOALS.includes(goal as (typeof SIP_GOALS)[number]) ||
      months === undefined ||
      !SIP_MONTHS.includes(months as (typeof SIP_MONTHS)[number])
    ) {
      throw new Error('SIP-goal variant parameters are outside their domains.');
    }
  }
  if (variant.templateKey === 'tpl-emergency-fund') {
    const { monthlyExpenses, months } = variant.parameters;
    if (
      monthlyExpenses === undefined ||
      !EMERGENCY_EXPENSES.includes(monthlyExpenses as (typeof EMERGENCY_EXPENSES)[number]) ||
      months === undefined ||
      !EMERGENCY_MONTHS.includes(months as (typeof EMERGENCY_MONTHS)[number])
    ) {
      throw new Error('Emergency-fund variant parameters are outside their domains.');
    }
  }
  if (variant.templateKey === 'tpl-tax-slab') {
    const { income, rate } = variant.parameters;
    if (
      income === undefined ||
      !TAX_INCOMES.includes(income as (typeof TAX_INCOMES)[number]) ||
      rate === undefined ||
      !TAX_RATES.includes(rate as (typeof TAX_RATES)[number])
    ) {
      throw new Error('Tax-slab variant parameters are outside their domains.');
    }
  }
}

/** Generates one variant from a registered template key and a seed. */
export function generateVariant(templateKey: string, seed: number): TemplateVariant {
  switch (templateKey) {
    case 'tpl-compounding':
      return generateCompounding(seed);
    case 'tpl-budgeting-503020':
      return generateBudgeting(seed);
    case 'tpl-simple-vs-compound':
      return generateSimpleVsCompound(seed);
    case 'tpl-sip-goal':
      return generateSipGoal(seed);
    case 'tpl-emergency-fund':
      return generateEmergencyFund(seed);
    case 'tpl-tax-slab':
      return generateTaxSlab(seed);
    default:
      throw new Error(`No generator registered for template key: ${templateKey}`);
  }
}
