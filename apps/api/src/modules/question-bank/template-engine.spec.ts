import {
  EMERGENCY_EXPENSES,
  EMERGENCY_MONTHS,
  formatInr,
  generateBudgeting,
  generateCompounding,
  generateEmergencyFund,
  generateSimpleVsCompound,
  generateSipGoal,
  generateTaxSlab,
  generateVariant,
  round100,
  SIMPLE_VS_COMPOUND_PRINCIPALS,
  SIMPLE_VS_COMPOUND_RATES,
  SIMPLE_VS_COMPOUND_YEARS,
  SIP_GOALS,
  SIP_MONTHS,
  TAX_INCOMES,
  TAX_RATES,
  validateVariant,
  type TemplateVariant,
} from './template-engine';

describe('template-engine (docs/05 §2.4)', () => {
  describe('round100 / formatInr', () => {
    it('rounds to the nearest ₹100', () => {
      expect(round100(13310)).toBe(13300);
      expect(round100(13350)).toBe(13400);
      expect(round100(10000)).toBe(10000);
    });

    it('formats whole rupees with Indian grouping', () => {
      expect(formatInr(13300)).toBe('₹13,300');
      expect(formatInr(100000)).toBe('₹1,00,000');
    });
  });

  describe('generateCompounding', () => {
    it('is deterministic: the same seed replays the same variant', () => {
      expect(generateCompounding(7)).toEqual(generateCompounding(7));
    });

    it('varies across seeds', () => {
      const stems = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => generateCompounding(s).stem));
      expect(stems.size).toBeGreaterThan(1);
    });

    it('computes the correct answer from the parameters for any seed', () => {
      for (let seed = 0; seed < 50; seed++) {
        const v = generateCompounding(seed);
        const principal = v.parameters.principal as number;
        const rate = v.parameters.rate as number;
        const years = v.parameters.years as number;
        const expected = formatInr(round100(principal * (1 + rate / 100) ** years));
        const correct = v.options.find((o) => o.isCorrect);
        expect(correct?.text).toBe(expected);
      }
    });

    it('worked example: ₹10,000 at 10% for 3 years → ₹13,310 (₹13,300 rounded)', () => {
      // Find a seed that draws exactly the doc's worked example.
      let example: TemplateVariant | undefined;
      for (let seed = 0; seed < 5000 && !example; seed++) {
        const v = generateCompounding(seed);
        if (
          v.parameters.principal === 10000 &&
          v.parameters.rate === 10 &&
          v.parameters.years === 3
        ) {
          example = v;
        }
      }
      expect(example).toBeDefined();
      const v = example as TemplateVariant;
      expect(v.stem).toContain('₹10,000');
      expect(v.stem).toContain('10%');
      expect(v.stem).toContain('3 years');
      const texts = v.options.map((o) => o.text);
      // Correct: 10000 × 1.1³ = 13310 → ₹13,300 rounded.
      expect(v.options.find((o) => o.isCorrect)?.text).toBe('₹13,300');
      // Distractors: simple interest ₹13,000, no growth ₹10,000, one year less ₹12,100.
      expect(texts).toContain('₹13,000');
      expect(texts).toContain('₹10,000');
      expect(texts).toContain('₹12,100');
      expect(new Set(texts).size).toBe(4);
    });

    it('always yields 4 distinct options with exactly 1 correct', () => {
      for (let seed = 0; seed < 100; seed++) {
        const v = generateCompounding(seed);
        expect(v.options).toHaveLength(4);
        expect(v.options.filter((o) => o.isCorrect)).toHaveLength(1);
        expect(new Set(v.options.map((o) => o.text)).size).toBe(4);
      }
    });
  });

  describe('generateBudgeting', () => {
    it('is deterministic per seed and computes the 20% savings share', () => {
      expect(generateBudgeting(3)).toEqual(generateBudgeting(3));
      for (let seed = 0; seed < 50; seed++) {
        const v = generateBudgeting(seed);
        const income = v.parameters.income as number;
        expect(v.options.find((o) => o.isCorrect)?.text).toBe(formatInr(income * 0.2));
        expect(v.options).toHaveLength(4);
        expect(new Set(v.options.map((o) => o.text)).size).toBe(4);
      }
    });

    it('distractors are the 30% wants, 50% needs, and 10% half-savings shares', () => {
      let example: TemplateVariant | undefined;
      for (let seed = 0; seed < 5000 && !example; seed++) {
        const v = generateBudgeting(seed);
        if (v.parameters.income === 50000) example = v;
      }
      expect(example).toBeDefined();
      const texts = (example as TemplateVariant).options.map((o) => o.text);
      expect((example as TemplateVariant).options.find((o) => o.isCorrect)?.text).toBe('₹10,000');
      expect(texts).toContain('₹15,000');
      expect(texts).toContain('₹25,000');
      expect(texts).toContain('₹5,000');
    });
  });

  describe('generateVariant', () => {
    it('dispatches by template key', () => {
      expect(generateVariant('tpl-compounding', 1).templateKey).toBe('tpl-compounding');
      expect(generateVariant('tpl-budgeting-503020', 1).templateKey).toBe('tpl-budgeting-503020');
      expect(generateVariant('tpl-simple-vs-compound', 1).templateKey).toBe(
        'tpl-simple-vs-compound'
      );
      expect(generateVariant('tpl-sip-goal', 1).templateKey).toBe('tpl-sip-goal');
      expect(generateVariant('tpl-emergency-fund', 1).templateKey).toBe('tpl-emergency-fund');
      expect(generateVariant('tpl-tax-slab', 1).templateKey).toBe('tpl-tax-slab');
    });

    it('throws for an unregistered template key', () => {
      expect(() => generateVariant('tpl-nope', 1)).toThrow(/No generator registered/);
    });
  });

  describe('generateSimpleVsCompound', () => {
    const expectedDiff = (p: number, r: number, y: number) =>
      round100(p * (1 + r / 100) ** y) - round100(p * (1 + (r / 100) * y));

    it('is deterministic per seed and computes the difference from the parameters', () => {
      expect(generateSimpleVsCompound(11)).toEqual(generateSimpleVsCompound(11));
      for (let seed = 0; seed < 100; seed++) {
        const v = generateSimpleVsCompound(seed);
        const principal = v.parameters.principal as number;
        const rate = v.parameters.rate as number;
        const years = v.parameters.years as number;
        expect(v.options.find((o) => o.isCorrect)?.text).toBe(
          formatInr(expectedDiff(principal, rate, years))
        );
        expect(v.options).toHaveLength(4);
        expect(new Set(v.options.map((o) => o.text)).size).toBe(4);
      }
    });

    it('covers every domain combination with a positive, distinct difference', () => {
      const seen = new Set<string>();
      for (let seed = 0; seed < 100000 && seen.size < 27; seed++) {
        const v = generateSimpleVsCompound(seed);
        const principal = v.parameters.principal as number;
        const rate = v.parameters.rate as number;
        const years = v.parameters.years as number;
        seen.add(`${principal}:${rate}:${years}`);
        const diff = expectedDiff(principal, rate, years);
        expect(diff).toBeGreaterThan(0);
        expect(new Set(v.options.map((o) => o.text)).size).toBe(4);
      }
      expect(seen.size).toBe(
        SIMPLE_VS_COMPOUND_PRINCIPALS.length *
          SIMPLE_VS_COMPOUND_RATES.length *
          SIMPLE_VS_COMPOUND_YEARS.length
      );
    });

    it('worked example: ₹20,000 at 10% for 3 years → compounding beats simple by ₹600', () => {
      let example: TemplateVariant | undefined;
      for (let seed = 0; seed < 5000 && !example; seed++) {
        const v = generateSimpleVsCompound(seed);
        if (
          v.parameters.principal === 20000 &&
          v.parameters.rate === 10 &&
          v.parameters.years === 3
        ) {
          example = v;
        }
      }
      expect(example).toBeDefined();
      const v = example as TemplateVariant;
      // Compound: 20000 × 1.1³ = 26620 → ₹26,600. Simple: 20000 × 1.3 = ₹26,000.
      expect(v.options.find((o) => o.isCorrect)?.text).toBe('₹600');
      const texts = v.options.map((o) => o.text);
      expect(texts).toContain('₹0 — simple and compound give the same total');
      expect(texts).toContain('₹1,200');
      expect(texts).toContain('₹300');
    });
  });

  describe('generateSipGoal', () => {
    it('is deterministic per seed and computes goal ÷ months from the parameters', () => {
      expect(generateSipGoal(11)).toEqual(generateSipGoal(11));
      for (let seed = 0; seed < 100; seed++) {
        const v = generateSipGoal(seed);
        const goal = v.parameters.goal as number;
        const months = v.parameters.months as number;
        expect(v.options.find((o) => o.isCorrect)?.text).toBe(formatInr(round100(goal / months)));
        expect(v.options).toHaveLength(4);
        expect(new Set(v.options.map((o) => o.text)).size).toBe(4);
      }
    });

    it('covers every domain combination with 4 distinct options', () => {
      const seen = new Set<string>();
      for (let seed = 0; seed < 100000 && seen.size < 30; seed++) {
        const v = generateSipGoal(seed);
        const { goal, months } = v.parameters;
        seen.add(`${goal}:${months}`);
        expect(new Set(v.options.map((o) => o.text)).size).toBe(4);
      }
      expect(seen.size).toBe(SIP_GOALS.length * SIP_MONTHS.length);
    });

    it('worked example: ₹1,20,000 in 24 months → ₹5,000 a month', () => {
      let example: TemplateVariant | undefined;
      for (let seed = 0; seed < 5000 && !example; seed++) {
        const v = generateSipGoal(seed);
        if (v.parameters.goal === 120000 && v.parameters.months === 24) example = v;
      }
      expect(example).toBeDefined();
      const v = example as TemplateVariant;
      expect(v.options.find((o) => o.isCorrect)?.text).toBe('₹5,000');
      const texts = v.options.map((o) => o.text);
      expect(texts).toContain('₹10,000');
      expect(texts).toContain('₹2,500');
      expect(texts).toContain('₹12,000');
    });
  });

  describe('generateEmergencyFund', () => {
    it('is deterministic per seed and computes expenses × months', () => {
      expect(generateEmergencyFund(11)).toEqual(generateEmergencyFund(11));
      for (let seed = 0; seed < 100; seed++) {
        const v = generateEmergencyFund(seed);
        const monthlyExpenses = v.parameters.monthlyExpenses as number;
        const months = v.parameters.months as number;
        expect(v.options.find((o) => o.isCorrect)?.text).toBe(formatInr(monthlyExpenses * months));
        expect(v.options).toHaveLength(4);
        expect(new Set(v.options.map((o) => o.text)).size).toBe(4);
      }
    });

    it('covers every domain combination with 4 distinct options', () => {
      const seen = new Set<string>();
      for (let seed = 0; seed < 100000 && seen.size < 24; seed++) {
        const v = generateEmergencyFund(seed);
        const { monthlyExpenses, months } = v.parameters;
        seen.add(`${monthlyExpenses}:${months}`);
        expect(new Set(v.options.map((o) => o.text)).size).toBe(4);
      }
      expect(seen.size).toBe(EMERGENCY_EXPENSES.length * EMERGENCY_MONTHS.length);
    });

    it('worked example: ₹20,000 a month × 6 months → ₹1,20,000', () => {
      let example: TemplateVariant | undefined;
      for (let seed = 0; seed < 5000 && !example; seed++) {
        const v = generateEmergencyFund(seed);
        if (v.parameters.monthlyExpenses === 20000 && v.parameters.months === 6) example = v;
      }
      expect(example).toBeDefined();
      const v = example as TemplateVariant;
      expect(v.options.find((o) => o.isCorrect)?.text).toBe('₹1,20,000');
      const texts = v.options.map((o) => o.text);
      expect(texts).toContain('₹20,000');
      expect(texts).toContain('₹2,40,000');
      expect(texts).toContain('₹1,80,000');
    });
  });

  describe('generateTaxSlab', () => {
    it('is deterministic per seed and taxes only income above ₹3,00,000', () => {
      expect(generateTaxSlab(11)).toEqual(generateTaxSlab(11));
      for (let seed = 0; seed < 100; seed++) {
        const v = generateTaxSlab(seed);
        const income = v.parameters.income as number;
        const rate = v.parameters.rate as number;
        expect(v.options.find((o) => o.isCorrect)?.text).toBe(
          formatInr(((income - 300000) * rate) / 100)
        );
        expect(v.options).toHaveLength(4);
        expect(new Set(v.options.map((o) => o.text)).size).toBe(4);
      }
    });

    it('covers every domain combination with 4 distinct options', () => {
      const seen = new Set<string>();
      for (let seed = 0; seed < 100000 && seen.size < 32; seed++) {
        const v = generateTaxSlab(seed);
        const { income, rate } = v.parameters;
        seen.add(`${income}:${rate}`);
        expect(new Set(v.options.map((o) => o.text)).size).toBe(4);
      }
      expect(seen.size).toBe(TAX_INCOMES.length * TAX_RATES.length);
    });

    it('worked example: ₹6,00,000 at 10% → tax ₹30,000 on ₹3,00,000', () => {
      let example: TemplateVariant | undefined;
      for (let seed = 0; seed < 5000 && !example; seed++) {
        const v = generateTaxSlab(seed);
        if (v.parameters.income === 600000 && v.parameters.rate === 10) example = v;
      }
      expect(example).toBeDefined();
      const v = example as TemplateVariant;
      expect(v.options.find((o) => o.isCorrect)?.text).toBe('₹30,000');
      const texts = v.options.map((o) => o.text);
      expect(texts).toContain('₹60,000');
      expect(texts).toContain('₹50,000');
      expect(texts).toContain('₹15,000');
    });
  });

  describe('validateVariant', () => {
    it('rejects duplicate option texts', () => {
      const v = generateCompounding(1);
      const bad: TemplateVariant = {
        ...v,
        options: [
          { text: '₹10,000', isCorrect: true },
          { text: '₹10,000', isCorrect: false },
          { text: '₹20,000', isCorrect: false },
          { text: '₹30,000', isCorrect: false },
        ],
      };
      expect(() => validateVariant(bad)).toThrow(/distinct/);
    });

    it('rejects parameters outside their domains', () => {
      const v = generateCompounding(1);
      const bad: TemplateVariant = {
        ...v,
        parameters: { principal: 99999, rate: 10, years: 3 },
      };
      expect(() => validateVariant(bad)).toThrow(/outside their domains/);
    });

    it('rejects out-of-domain parameters for each Phase 4 template', () => {
      const badSimple: TemplateVariant = {
        ...generateSimpleVsCompound(1),
        parameters: { principal: 10000, rate: 10, years: 3 },
      };
      expect(() => validateVariant(badSimple)).toThrow(/outside their domains/);
      const badSip: TemplateVariant = {
        ...generateSipGoal(1),
        parameters: { goal: 99999, months: 12 },
      };
      expect(() => validateVariant(badSip)).toThrow(/outside their domains/);
      const badEmergency: TemplateVariant = {
        ...generateEmergencyFund(1),
        parameters: { monthlyExpenses: 99999, months: 3 },
      };
      expect(() => validateVariant(badEmergency)).toThrow(/outside their domains/);
      const badTax: TemplateVariant = {
        ...generateTaxSlab(1),
        parameters: { income: 100000, rate: 10 },
      };
      expect(() => validateVariant(badTax)).toThrow(/outside their domains/);
    });
  });
});
