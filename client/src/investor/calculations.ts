// ---------------------------------------------------------------------------
// Investor-ledger math. Everything is pro-rata on contribution share, matching
// the source spreadsheet:
//
//   weight = contribution / Σ contributions        ("% of Total Capital")
//   gross  = weight × totalProfit                  ("Gross Profit Allocation")
//   fee    = weight × totalFees                    ("Fee Share")
//   net    = gross − fee                           ("Net Profit")
//   pct    = gross / contribution                  ("% Gain/Loss")
//   netPct = net   / contribution                  ("Net % Gain/Loss")
//
// Fees are deducted regardless of whether the month was up or down, which is
// how the spreadsheet behaves.
// ---------------------------------------------------------------------------

export interface RawInvestor {
  id: number;
  name: string;
  active: boolean;
  sortIdx: number;
}

export interface RawPeriod {
  id: number;
  year: number;
  month: number; // 1-12
  totalProfit: number;
  totalFees: number;
  notes: string | null;
}

export interface RawEntry {
  periodId: number;
  investorId: number;
  contribution: number;
  withdrawalFee?: number;
}

export interface InvestorRow {
  investorId: number;
  name: string;
  contribution: number;
  weight: number; // 0..1
  gross: number;
  fee: number;
  net: number;
  pct: number; // gross / contribution, 0..1
  netPct: number; // net / contribution, 0..1
  withdrawalFee: number; // wire fee this investor bore this month
  nextOpening: number; // contribution + net − withdrawalFee (carries forward)
}

export interface PeriodView {
  id: number;
  year: number;
  month: number;
  label: string; // "Aug 2026"
  totalCapital: number;
  totalProfit: number;
  totalFees: number;
  netProfit: number; // totalProfit − totalFees
  pct: number; // fund-level gross return
  netPct: number; // fund-level net return
  notes: string | null;
  rows: InvestorRow[];
}

export const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function buildPeriodView(
  period: RawPeriod,
  investors: RawInvestor[],
  entries: RawEntry[],
): PeriodView {
  const mine = entries.filter((e) => e.periodId === period.id);
  const byInvestor = new Map(mine.map((e) => [e.investorId, e.contribution]));
  const feeByInvestor = new Map(
    mine.map((e) => [e.investorId, e.withdrawalFee ?? 0]),
  );

  // Only investors with a row in this month appear — someone added later
  // shouldn't retroactively show up in earlier months.
  const present = investors.filter((i) => byInvestor.has(i.id));
  const totalCapital = present.reduce(
    (sum, i) => sum + (byInvestor.get(i.id) ?? 0),
    0,
  );

  const rows: InvestorRow[] = present.map((i) => {
    const contribution = byInvestor.get(i.id) ?? 0;
    const withdrawalFee = feeByInvestor.get(i.id) ?? 0;
    const weight = totalCapital > 0 ? contribution / totalCapital : 0;
    const gross = weight * period.totalProfit;
    const fee = weight * period.totalFees;
    const net = gross - fee;
    return {
      investorId: i.id,
      name: i.name,
      contribution,
      weight,
      gross,
      fee,
      net,
      pct: contribution > 0 ? gross / contribution : 0,
      netPct: contribution > 0 ? net / contribution : 0,
      withdrawalFee,
      nextOpening: Math.round((contribution + net - withdrawalFee) * 100) / 100,
    };
  });

  const netProfit = period.totalProfit - period.totalFees;
  return {
    id: period.id,
    year: period.year,
    month: period.month,
    label: `${MONTHS[period.month - 1]} ${period.year}`,
    totalCapital,
    totalProfit: period.totalProfit,
    totalFees: period.totalFees,
    netProfit,
    pct: totalCapital > 0 ? period.totalProfit / totalCapital : 0,
    netPct: totalCapital > 0 ? netProfit / totalCapital : 0,
    notes: period.notes,
    rows,
  };
}

export interface YearInvestorSummary {
  investorId: number;
  name: string;
  months: number;
  // Capital as of the most recent month they appear in.
  latestContribution: number;
  grossTotal: number;
  feeTotal: number;
  netTotal: number;
  // Time-weighted-ish return: Σ net ÷ Σ contribution across months. With equal
  // monthly contributions this is just the simple return; when capital changes
  // it weights each month by the capital actually at risk that month.
  netReturn: number;
}

export interface YearSummary {
  year: number;
  periods: PeriodView[];
  totalProfit: number;
  totalFees: number;
  netProfit: number;
  // Capital in the latest month of the year — the fund's current size.
  latestCapital: number;
  bestMonth: PeriodView | null;
  worstMonth: PeriodView | null;
  greenMonths: number;
  redMonths: number;
  investors: YearInvestorSummary[];
}

export function buildYearSummary(
  year: number,
  allPeriods: PeriodView[],
): YearSummary {
  const periods = allPeriods
    .filter((p) => p.year === year)
    .sort((a, b) => a.month - b.month);

  const totalProfit = periods.reduce((s, p) => s + p.totalProfit, 0);
  const totalFees = periods.reduce((s, p) => s + p.totalFees, 0);
  const latest = periods[periods.length - 1] ?? null;

  const withCapital = periods.filter((p) => p.totalCapital > 0);
  const bestMonth =
    withCapital.length > 0
      ? withCapital.reduce((a, b) => (b.netPct > a.netPct ? b : a))
      : null;
  const worstMonth =
    withCapital.length > 0
      ? withCapital.reduce((a, b) => (b.netPct < a.netPct ? b : a))
      : null;

  // Per-investor roll-up across the year.
  const acc = new Map<number, YearInvestorSummary>();
  for (const p of periods) {
    for (const r of p.rows) {
      const cur = acc.get(r.investorId) ?? {
        investorId: r.investorId,
        name: r.name,
        months: 0,
        latestContribution: 0,
        grossTotal: 0,
        feeTotal: 0,
        netTotal: 0,
        netReturn: 0,
      };
      cur.name = r.name;
      cur.months += 1;
      cur.latestContribution = r.contribution; // periods are month-ascending
      cur.grossTotal += r.gross;
      cur.feeTotal += r.fee;
      cur.netTotal += r.net;
      acc.set(r.investorId, cur);
    }
  }
  // Denominator = Σ contribution over the months each investor participated.
  const contribSum = new Map<number, number>();
  for (const p of periods) {
    for (const r of p.rows) {
      contribSum.set(
        r.investorId,
        (contribSum.get(r.investorId) ?? 0) + r.contribution,
      );
    }
  }
  const investors = [...acc.values()].map((v) => {
    const denom = contribSum.get(v.investorId) ?? 0;
    return { ...v, netReturn: denom > 0 ? v.netTotal / denom : 0 };
  });

  return {
    year,
    periods,
    totalProfit,
    totalFees,
    netProfit: totalProfit - totalFees,
    latestCapital: latest?.totalCapital ?? 0,
    bestMonth,
    worstMonth,
    greenMonths: periods.filter((p) => p.netProfit > 0).length,
    redMonths: periods.filter((p) => p.netProfit < 0).length,
    investors,
  };
}

// Cumulative net P&L across every month, oldest first — for the equity chart.
export function buildCumulativeSeries(periods: PeriodView[]) {
  const sorted = [...periods].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month,
  );
  let running = 0;
  return sorted.map((p) => {
    running += p.netProfit;
    return {
      label: p.label,
      net: p.netProfit,
      cumulative: running,
      capital: p.totalCapital,
    };
  });
}
